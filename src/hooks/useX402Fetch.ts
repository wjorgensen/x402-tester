import { useMemo } from 'react';
import { useWalletClient } from 'wagmi';
import { wrapFetchWithPayment, decodeXPaymentResponse, Signer, PaymentRequirementsSelector } from 'x402-fetch';

/**
 * Hook to get a fetch function that automatically handles x402 payments
 * @param maxValue Optional cap per request (e.g. '$0.10')
 * @param selectPayment Optional selector to choose a payment option if server offers many
 */
export function useX402Fetch(
  maxValue?: string,
  selectPayment?: PaymentRequirementsSelector
) {
  const { data: walletClient } = useWalletClient();

  const paidFetch = useMemo(() => {
    if (!walletClient) return null;

    // Default selector prefers Base network from the parsed payment requirements array
    const defaultSelector: PaymentRequirementsSelector = (parsedRequirements: any[], network?: any) => {
      // Try to find Base network in the requirements
      const baseRequirement = parsedRequirements?.find((req: any) => req.network === 'base');
      if (baseRequirement) return baseRequirement;

      // Fallback to first requirement
      return parsedRequirements?.[0];
    };

    // Convert maxValue string to bigint (USDC has 6 decimals)
    const maxValueBigInt = maxValue
      ? BigInt(parseFloat(maxValue.replace('$', '')) * 1e6)
      : BigInt(0.1 * 1e6); // Default to 0.10 USDC

    // Type assertion: viem's WalletClient is compatible with x402's Signer interface
    return wrapFetchWithPayment(
      fetch,
      walletClient as unknown as Signer,
      maxValueBigInt,
      selectPayment || defaultSelector
    );
  }, [walletClient, maxValue, selectPayment]);

  return {
    paidFetch,
    decodeXPaymentResponse,
    isReady: !!paidFetch
  };
}
