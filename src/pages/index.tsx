import { ConnectButton } from '@rainbow-me/rainbowkit';
import type { NextPage } from 'next';
import Head from 'next/head';
import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { useUSDCBalance } from '../hooks/useUSDCBalance';
import { useX402Fetch } from '../hooks/useX402Fetch';

interface X402Endpoint {
  accepts: Array<{
    asset: string;
    description: string;
    maxAmountRequired: string;
    network: string;
    outputSchema: {
      input: {
        bodyFields?: Record<string, any>;
        headerFields?: Record<string, any>;
        method: string;
        type: string;
      };
      output?: Record<string, string>;
    };
    payTo: string;
    resource: string;
    scheme: string;
  }>;
  resource: string;
  type: string;
  metadata?: any;
}

const Home: NextPage = () => {
  const { isConnected } = useAccount();
  const { balance: usdcBalance, isLoading: isBalanceLoading } = useUSDCBalance();
  const { paidFetch, decodeXPaymentResponse, isReady } = useX402Fetch('$0.10');

  const [endpoints, setEndpoints] = useState<X402Endpoint[]>([]);
  const [urlInput, setUrlInput] = useState('');
  const [testingEndpoint, setTestingEndpoint] = useState<string | null>(null);
  const [responses, setResponses] = useState<Record<string, any>>({});

  // Modal state
  const [showInputModal, setShowInputModal] = useState(false);
  const [currentEndpoint, setCurrentEndpoint] = useState<X402Endpoint | null>(null);
  const [currentAcceptIndex, setCurrentAcceptIndex] = useState(0);
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [modalResponse, setModalResponse] = useState<any>(null);
  const [isModalLoading, setIsModalLoading] = useState(false);

  // Helper to format price from 6-decimal format to USD
  const formatPrice = (maxAmountRequired: string) => {
    if (!maxAmountRequired || maxAmountRequired === '0') return 'Free';
    const amount = parseFloat(maxAmountRequired) / 1e6;
    return `$${amount.toFixed(amount < 0.01 ? 4 : 2)}`;
  };

  useEffect(() => {
    fetch('/x402-endpoints.json')
      .then(res => res.json())
      .then(data => setEndpoints(data))
      .catch(err => console.error('Failed to load endpoints:', err));
  }, []);

  const handleTestEndpoint = (endpoint: X402Endpoint, acceptIndex: number = 0) => {
    if (!isConnected || !paidFetch) return;

    const accept = endpoint.accepts[acceptIndex];
    const bodyFields = accept.outputSchema.input.bodyFields;
    const headerFields = accept.outputSchema.input.headerFields;

    // Check for mixed content issue
    const url = accept.resource;
    const isHttps = window.location.protocol === 'https:';
    const endpointIsHttp = url.startsWith('http://');

    if (isHttps && endpointIsHttp) {
      console.warn('[x402] Mixed Content Warning:', {
        pageProtocol: window.location.protocol,
        endpointProtocol: 'http:',
        url: url
      });
    }

    // Filter out x402 payment headers
    const filterPaymentHeaders = (headers: Record<string, any>) => {
      return Object.entries(headers).filter(([key]) => {
        const lowerKey = key.toLowerCase();
        return (
          !lowerKey.includes('x-payment') &&
          !lowerKey.includes('authorization') &&
          !lowerKey.includes('x-402')
        );
      });
    };

    const hasBodyFields = bodyFields && Object.keys(bodyFields).length > 0;
    const userHeaderFields = headerFields ? filterPaymentHeaders(headerFields) : [];
    const hasUserHeaders = userHeaderFields.length > 0;

    // Check if there are any actual user input fields required
    if (hasBodyFields || hasUserHeaders) {
      // Open modal for user input
      setCurrentEndpoint(endpoint);
      setCurrentAcceptIndex(acceptIndex);
      setInputValues({});
      setModalResponse(null);
      setIsModalLoading(false);
      setShowInputModal(true);
    } else {
      // No user inputs required, execute directly
      executeRequest(endpoint, acceptIndex, {});
    }
  };

  const executeRequest = async (
    endpoint: X402Endpoint,
    acceptIndex: number,
    inputs: Record<string, string>
  ) => {
    if (!isConnected || !paidFetch) return;

    const accept = endpoint.accepts[acceptIndex];
    const url = accept.resource;
    setTestingEndpoint(url);
    setIsModalLoading(true);
    setModalResponse(null);

    console.log('[x402] Testing endpoint:', url);
    console.log('[x402] Payment requirements:', accept);
    console.log('[x402] User inputs:', inputs);

    try {
      const method = accept.outputSchema.input.method || 'GET';
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // Add header fields if specified
      if (accept.outputSchema.input.headerFields) {
        Object.keys(accept.outputSchema.input.headerFields).forEach(key => {
          if (inputs[key]) {
            headers[key] = inputs[key];
          }
        });
      }

      // Prepare body for non-GET requests
      let body = undefined;
      if (method !== 'GET' && accept.outputSchema.input.bodyFields) {
        const bodyData: Record<string, any> = {};
        Object.keys(accept.outputSchema.input.bodyFields).forEach(key => {
          if (inputs[key] !== undefined) {
            bodyData[key] = inputs[key];
          }
        });
        body = JSON.stringify(bodyData);
      }

      console.log('[x402] Making request with method:', method);
      console.log('[x402] Headers:', headers);
      console.log('[x402] Body:', body);

      const res = await paidFetch(url, {
        method,
        headers,
        body,
        mode: 'cors',
        credentials: 'omit',
      });

      console.log('[x402] Response status:', res.status);
      console.log('[x402] Response headers:', Object.fromEntries(res.headers.entries()));

      // Check for payment settlement
      const settlementHeader = res.headers.get('x-payment-response');
      let settlement = null;
      if (settlementHeader) {
        settlement = decodeXPaymentResponse(settlementHeader);
        console.log('[x402] Payment settlement:', settlement);
      }

      const contentType = res.headers.get('content-type');
      let data;

      if (contentType?.includes('application/json')) {
        data = await res.json();
      } else {
        data = await res.text();
      }

      const responseData = {
        status: res.status,
        data,
        settlement
      };

      // Update both modal and card responses
      setModalResponse(responseData);
      setResponses({
        ...responses,
        [url]: responseData
      });
    } catch (err: any) {
      console.error('[x402] Error:', err);
      console.error('[x402] Error details:', {
        message: err.message,
        name: err.name,
        stack: err.stack
      });

      // Check for mixed content error
      const isMixedContent =
        typeof window !== 'undefined' &&
        window.location.protocol === 'https:' &&
        url.startsWith('http://');

      // Check if it's a CORS error (only if not mixed content)
      const isCorsError =
        !isMixedContent &&
        (err.message.includes('CORS') ||
          err.message.includes('Failed to fetch') ||
          err.message.includes('Network request failed'));

      const errorData = {
        error: err.message,
        errorType: err.name,
        status: 'error',
        isCorsError,
        isMixedContent,
        details: isMixedContent
          ? 'Mixed Content error: Cannot load HTTP content from an HTTPS page. The endpoint must be available over HTTPS.'
          : isCorsError
          ? 'CORS error: The server must allow cross-origin requests and include the X-PAYMENT header in Access-Control-Allow-Headers. This is a server-side configuration issue.'
          : 'Check browser console for more details'
      };

      setModalResponse(errorData);
      setResponses({
        ...responses,
        [url]: errorData
      });
    } finally {
      setTestingEndpoint(null);
      setIsModalLoading(false);
    }
  };

  const handleUrlTest = async () => {
    if (!isConnected || !paidFetch || !urlInput.trim()) return;

    setTestingEndpoint(urlInput);
    setResponses({ ...responses, [urlInput]: null });

    console.log('[x402] Testing custom URL:', urlInput);

    try {
      const res = await paidFetch(urlInput, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
      });

      console.log('[x402] Response status:', res.status);
      console.log('[x402] Response headers:', Object.fromEntries(res.headers.entries()));

      const settlementHeader = res.headers.get('x-payment-response');
      let settlement = null;
      if (settlementHeader) {
        settlement = decodeXPaymentResponse(settlementHeader);
        console.log('[x402] Payment settlement:', settlement);
      }

      const contentType = res.headers.get('content-type');
      let data;

      if (contentType?.includes('application/json')) {
        data = await res.json();
      } else {
        data = await res.text();
      }

      setResponses({
        ...responses,
        [urlInput]: {
          status: res.status,
          data,
          settlement
        }
      });
    } catch (err: any) {
      console.error('[x402] Error:', err);
      console.error('[x402] Error details:', {
        message: err.message,
        name: err.name,
        stack: err.stack
      });

      setResponses({
        ...responses,
        [urlInput]: {
          error: err.message,
          errorType: err.name,
          status: 'error',
          details: 'Check browser console for more details'
        }
      });
    } finally {
      setTestingEndpoint(null);
    }
  };

  return (
    <div className="min-h-screen bg-dark-bg">
      <Head>
        <title>x402 Endpoint Tester</title>
        <meta content="Test x402 payment endpoints on Base" name="description" />
      </Head>

      {/* Header */}
      <header className="border-b border-dark-border bg-dark-surface">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-dark-text-primary">
              x402 Endpoint Tester
            </h1>

            <div className="flex items-center gap-4">
              {/* USDC Balance */}
              {isConnected && (
                <div className="px-4 py-2 bg-dark-surface border border-dark-border rounded-lg">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-dark-text-secondary">USDC Balance:</span>
                    <span className="font-semibold text-dark-accent-green">
                      {isBalanceLoading ? '...' : `$${usdcBalance}`}
                    </span>
                  </div>
                </div>
              )}

              {/* Wallet Connect */}
              <ConnectButton.Custom>
                {({ account, chain, openConnectModal, mounted }) => {
                  const ready = mounted;
                  const connected = ready && account;

                  return (
                    <div
                      {...(!ready && {
                        'aria-hidden': true,
                        style: {
                          opacity: 0,
                          pointerEvents: 'none',
                          userSelect: 'none',
                        },
                      })}
                    >
                      {(() => {
                        if (!connected) {
                          return (
                            <button
                              onClick={openConnectModal}
                              className="px-6 py-2 bg-dark-accent-blue hover:bg-dark-accent-blueHover text-white font-semibold rounded-lg transition-colors"
                            >
                              Connect Wallet
                            </button>
                          );
                        }

                        return (
                          <div className="flex items-center gap-3">
                            <div className="px-4 py-2 bg-dark-surface border border-dark-border rounded-lg">
                              <span className="text-sm font-medium text-dark-text-primary">
                                {account.displayName}
                              </span>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  );
                }}
              </ConnectButton.Custom>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* URL Input Section */}
        <div className="mb-12">
          <div className="max-w-3xl mx-auto">
            <div className="flex gap-3">
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="Enter endpoint URL to test..."
                className="flex-1 px-6 py-4 bg-dark-surface border border-dark-border rounded-lg text-dark-text-primary placeholder-dark-text-muted focus:outline-none focus:ring-2 focus:ring-dark-accent-blue focus:border-transparent text-lg"
                onKeyDown={(e) => e.key === 'Enter' && handleUrlTest()}
              />
              <button
                onClick={handleUrlTest}
                disabled={!isConnected || !isReady || !urlInput.trim()}
                className="px-8 py-4 bg-dark-accent-blue hover:bg-dark-accent-blueHover disabled:bg-dark-border disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors text-lg"
              >
                {testingEndpoint === urlInput ? 'Sending...' : 'Send'}
              </button>
            </div>

            {!isConnected && (
              <p className="mt-3 text-center text-sm text-dark-text-muted">
                Connect your wallet to test endpoints
              </p>
            )}

            {urlInput && responses[urlInput] && (
              <div className="mt-4 p-4 bg-dark-surface border border-dark-border rounded-lg">
                <h3 className="text-sm font-semibold text-dark-text-primary mb-2">Response:</h3>
                <pre className="text-xs text-dark-text-secondary overflow-auto max-h-96">
                  {JSON.stringify(responses[urlInput], null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>

        {/* Endpoints Grid */}
        <div>
          <h2 className="text-xl font-bold text-dark-text-primary mb-6">
            Available Endpoints ({endpoints.length})
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {endpoints.map((endpoint, idx) => {
              const accept = endpoint.accepts[0];
              const url = accept.resource;
              const isTesting = testingEndpoint === url;
              const response = responses[url];

              return (
                <div
                  key={idx}
                  className="bg-dark-surface border border-dark-border rounded-lg p-5 hover:border-dark-accent-blue transition-colors"
                >
                  {/* URL */}
                  <div className="mb-3">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="text-xs text-dark-text-muted">Endpoint</div>
                      {url.startsWith('https://') && (
                        <span className="px-2 py-0.5 bg-dark-accent-green bg-opacity-20 text-dark-accent-green text-xs font-semibold rounded">
                          HTTPS
                        </span>
                      )}
                      {url.startsWith('http://') && (
                        <span className="px-2 py-0.5 bg-yellow-500 bg-opacity-20 text-yellow-400 text-xs font-semibold rounded">
                          HTTP
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-dark-text-primary font-mono truncate" title={url}>
                      {url}
                    </div>
                  </div>

                  {/* Description */}
                  {accept.description && (
                    <div className="mb-3">
                      <div className="text-xs text-dark-text-secondary">
                        {accept.description}
                      </div>
                    </div>
                  )}

                  {/* Price */}
                  <div className="mb-4">
                    <div className="text-xs text-dark-text-muted mb-1">Price</div>
                    <div className="text-lg font-semibold text-dark-accent-green">
                      {formatPrice(accept.maxAmountRequired)}
                    </div>
                    <div className="text-xs text-dark-text-muted">
                      {accept.network}
                    </div>
                  </div>

                  {/* Test Button */}
                  <button
                    onClick={() => handleTestEndpoint(endpoint)}
                    disabled={!isConnected || !isReady || isTesting}
                    className="w-full px-4 py-2 bg-dark-accent-purple hover:bg-dark-accent-purpleHover disabled:bg-dark-border disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors text-sm"
                  >
                    {isTesting ? 'Testing...' : 'Test'}
                  </button>

                  {/* Response Preview */}
                  {response && (
                    <div className="mt-3 pt-3 border-t border-dark-border">
                      <div className="text-xs">
                        <span className={`font-semibold ${response.error ? 'text-red-400' : 'text-dark-accent-green'}`}>
                          {response.error ? 'Error' : `Status: ${response.status}`}
                        </span>
                        {response.settlement && (
                          <div className="text-dark-text-muted mt-1">
                            Paid via x402
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {endpoints.length === 0 && (
            <div className="text-center py-12">
              <p className="text-dark-text-muted">No endpoints loaded</p>
            </div>
          )}
        </div>
      </main>

      {/* Input Modal */}
      {showInputModal && currentEndpoint && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className="bg-dark-surface border border-dark-border rounded-lg max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="sticky top-0 bg-dark-surface border-b border-dark-border p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-dark-text-primary">
                  Enter Request Parameters
                </h2>
                <button
                  onClick={() => setShowInputModal(false)}
                  className="text-dark-text-muted hover:text-dark-text-primary transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <p className="text-sm text-dark-text-secondary mt-2 break-all">
                {currentEndpoint.accepts[currentAcceptIndex].resource}
              </p>

              {/* Mixed Content Warning */}
              {typeof window !== 'undefined' && window.location.protocol === 'https:' && currentEndpoint.accepts[currentAcceptIndex].resource.startsWith('http://') && (
                <div className="mt-3 p-3 bg-red-500 bg-opacity-10 border border-red-500 border-opacity-30 rounded-lg">
                  <div className="flex items-start gap-2">
                    <svg className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div className="flex-1">
                      <p className="text-xs text-red-200 font-semibold">Mixed Content Warning</p>
                      <p className="text-xs text-red-300 mt-1">
                        This endpoint uses HTTP but your site is served over HTTPS. Browsers block HTTP requests from HTTPS pages for security. The endpoint must be available over HTTPS.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* CORS Warning */}
              {!(typeof window !== 'undefined' && window.location.protocol === 'https:' && currentEndpoint.accepts[currentAcceptIndex].resource.startsWith('http://')) && (
                <div className="mt-3 p-3 bg-yellow-500 bg-opacity-10 border border-yellow-500 border-opacity-30 rounded-lg">
                  <div className="flex items-start gap-2">
                    <svg className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div className="flex-1">
                      <p className="text-xs text-yellow-200 font-semibold">CORS Required</p>
                      <p className="text-xs text-yellow-300 mt-1">
                        If this request fails, the server needs to enable CORS with Access-Control-Allow-Origin and allow the X-PAYMENT header.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Body */}
            <div className="p-6">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  executeRequest(currentEndpoint, currentAcceptIndex, inputValues);
                }}
              >
                {/* Body Fields */}
                {currentEndpoint.accepts[currentAcceptIndex].outputSchema.input.bodyFields &&
                  Object.entries(
                    currentEndpoint.accepts[currentAcceptIndex].outputSchema.input.bodyFields
                  ).map(([key, field]: [string, any]) => (
                    <div key={key} className="mb-4">
                      <label className="block text-sm font-medium text-dark-text-primary mb-2">
                        {key}
                        {field.required && <span className="text-red-400 ml-1">*</span>}
                      </label>
                      <input
                        type={field.type === 'number' ? 'number' : 'text'}
                        value={inputValues[key] || ''}
                        onChange={(e) =>
                          setInputValues({ ...inputValues, [key]: e.target.value })
                        }
                        placeholder={field.description || field.default || `Enter ${key}`}
                        required={field.required}
                        className="w-full px-4 py-2 bg-dark-bg border border-dark-border rounded-lg text-dark-text-primary placeholder-dark-text-muted focus:outline-none focus:ring-2 focus:ring-dark-accent-blue focus:border-transparent"
                      />
                      {field.description && (
                        <p className="text-xs text-dark-text-muted mt-1">{field.description}</p>
                      )}
                    </div>
                  ))}

                {/* Header Fields */}
                {currentEndpoint.accepts[currentAcceptIndex].outputSchema.input.headerFields &&
                  Object.entries(
                    currentEndpoint.accepts[currentAcceptIndex].outputSchema.input.headerFields
                  )
                    .filter(([key]) => {
                      // Filter out x402 payment-related headers that are auto-generated
                      const lowerKey = key.toLowerCase();
                      return (
                        !lowerKey.includes('x-payment') &&
                        !lowerKey.includes('authorization') &&
                        !lowerKey.includes('x-402')
                      );
                    })
                    .map(([key, field]: [string, any]) => (
                      <div key={key} className="mb-4">
                        <label className="block text-sm font-medium text-dark-text-primary mb-2">
                          {key} <span className="text-xs text-dark-text-muted">(Header)</span>
                          {field.required && <span className="text-red-400 ml-1">*</span>}
                        </label>
                        <input
                          type="text"
                          value={inputValues[key] || ''}
                          onChange={(e) =>
                            setInputValues({ ...inputValues, [key]: e.target.value })
                          }
                          placeholder={field.description || field.default || `Enter ${key}`}
                          required={field.required}
                          className="w-full px-4 py-2 bg-dark-bg border border-dark-border rounded-lg text-dark-text-primary placeholder-dark-text-muted focus:outline-none focus:ring-2 focus:ring-dark-accent-blue focus:border-transparent"
                        />
                        {field.description && (
                          <p className="text-xs text-dark-text-muted mt-1">{field.description}</p>
                        )}
                      </div>
                    ))}

                {/* Price Info */}
                <div className="mt-6 p-4 bg-dark-bg border border-dark-border rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-dark-text-secondary">Price:</span>
                    <span className="text-lg font-semibold text-dark-accent-green">
                      {formatPrice(
                        currentEndpoint.accepts[currentAcceptIndex].maxAmountRequired
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-sm text-dark-text-secondary">Network:</span>
                    <span className="text-sm text-dark-text-primary">
                      {currentEndpoint.accepts[currentAcceptIndex].network}
                    </span>
                  </div>
                </div>

                {/* Loading State */}
                {isModalLoading && (
                  <div className="mt-6 p-6 bg-dark-bg border border-dark-border rounded-lg">
                    <div className="flex items-center justify-center gap-3">
                      <div className="w-5 h-5 border-2 border-dark-accent-blue border-t-transparent rounded-full animate-spin"></div>
                      <span className="text-dark-text-secondary">
                        Processing payment and sending request...
                      </span>
                    </div>
                  </div>
                )}

                {/* Response Display */}
                {modalResponse && !isModalLoading && (
                  <div className="mt-6 p-4 bg-dark-bg border border-dark-border rounded-lg">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-lg font-semibold text-dark-text-primary">Response</h3>
                      {modalResponse.status && (
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-semibold ${
                            modalResponse.status === 200 || modalResponse.status === 201
                              ? 'bg-dark-accent-green bg-opacity-20 text-dark-accent-green'
                              : modalResponse.status === 'error'
                              ? 'bg-red-500 bg-opacity-20 text-red-400'
                              : 'bg-yellow-500 bg-opacity-20 text-yellow-400'
                          }`}
                        >
                          {modalResponse.status === 'error' ? 'Error' : `HTTP ${modalResponse.status}`}
                        </span>
                      )}
                    </div>

                    {/* Mixed Content Error Explanation */}
                    {modalResponse.isMixedContent && (
                      <div className="mb-3 p-3 bg-red-500 bg-opacity-10 border border-red-500 border-opacity-30 rounded-lg">
                        <div className="flex items-start gap-2">
                          <svg className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <div className="flex-1">
                            <p className="text-xs text-red-300 font-semibold">Mixed Content Blocked</p>
                            <p className="text-xs text-red-200 mt-1">
                              Your app is served over HTTPS, but this endpoint uses HTTP. Browsers block HTTP requests from HTTPS pages for security.
                            </p>
                            <p className="text-xs text-red-200 mt-2 font-semibold">
                              Solutions:
                            </p>
                            <ul className="text-xs text-red-200 mt-1 list-disc list-inside space-y-1">
                              <li>The endpoint provider should serve it over HTTPS</li>
                              <li>Or test your app locally using HTTP (http://localhost)</li>
                            </ul>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* CORS Error Explanation */}
                    {modalResponse.isCorsError && !modalResponse.isMixedContent && (
                      <div className="mb-3 p-3 bg-red-500 bg-opacity-10 border border-red-500 border-opacity-30 rounded-lg">
                        <div className="flex items-start gap-2">
                          <svg className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <div className="flex-1">
                            <p className="text-xs text-red-300 font-semibold">CORS Configuration Error</p>
                            <p className="text-xs text-red-200 mt-1">
                              The server blocked this request. The endpoint needs:
                            </p>
                            <ul className="text-xs text-red-200 mt-1 list-disc list-inside space-y-1">
                              <li>Access-Control-Allow-Origin header</li>
                              <li>Access-Control-Allow-Headers including "X-PAYMENT"</li>
                              <li>Access-Control-Allow-Methods for the HTTP method used</li>
                            </ul>
                            <p className="text-xs text-red-200 mt-2">
                              This is a server-side issue that the API provider needs to fix.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {modalResponse.settlement && (
                      <div className="mb-3 p-3 bg-dark-surface rounded-lg border border-dark-accent-green border-opacity-30">
                        <div className="flex items-center gap-2 text-dark-accent-green">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          <span className="text-sm font-semibold">Payment Successful</span>
                        </div>
                        {modalResponse.settlement.txHash && (
                          <p className="text-xs text-dark-text-muted mt-1 font-mono">
                            Tx: {modalResponse.settlement.txHash.slice(0, 10)}...
                            {modalResponse.settlement.txHash.slice(-8)}
                          </p>
                        )}
                      </div>
                    )}

                    <div className="max-h-96 overflow-auto">
                      <pre className="text-xs text-dark-text-secondary whitespace-pre-wrap break-words">
                        {modalResponse.error
                          ? JSON.stringify(
                              {
                                error: modalResponse.error,
                                type: modalResponse.errorType,
                                details: modalResponse.details,
                              },
                              null,
                              2
                            )
                          : JSON.stringify(modalResponse.data, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}

                {/* Modal Footer */}
                <div className="flex gap-3 mt-6">
                  <button
                    type="button"
                    onClick={() => {
                      setShowInputModal(false);
                      setModalResponse(null);
                      setInputValues({});
                    }}
                    className="flex-1 px-6 py-3 bg-dark-surface border border-dark-border hover:bg-dark-surfaceHover text-dark-text-primary font-semibold rounded-lg transition-colors"
                  >
                    {modalResponse ? 'Close' : 'Cancel'}
                  </button>
                  {!modalResponse && (
                    <button
                      type="submit"
                      disabled={isModalLoading}
                      className="flex-1 px-6 py-3 bg-dark-accent-blue hover:bg-dark-accent-blueHover disabled:bg-dark-border disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors"
                    >
                      {isModalLoading ? 'Sending...' : 'Send Payment & Request'}
                    </button>
                  )}
                  {modalResponse && !modalResponse.error && (
                    <button
                      type="button"
                      onClick={() => {
                        setModalResponse(null);
                        setInputValues({});
                      }}
                      className="flex-1 px-6 py-3 bg-dark-accent-blue hover:bg-dark-accent-blueHover text-white font-semibold rounded-lg transition-colors"
                    >
                      New Request
                    </button>
                  )}
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Home;
