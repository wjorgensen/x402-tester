import { useAccount, useReadContract } from 'wagmi';
import { formatUnits } from 'viem';

const USDC_ADDRESS = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const USDC_DECIMALS = 6;

// ERC20 balanceOf ABI
const ERC20_ABI = [
  {
    constant: true,
    inputs: [{ name: '_owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: 'balance', type: 'uint256' }],
    type: 'function',
  },
] as const;

export function useUSDCBalance() {
  const { address, isConnected } = useAccount();

  const { data: balance, isLoading, refetch } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: {
      enabled: Boolean(address && isConnected),
      refetchInterval: 10000, // Refetch every 10 seconds
    },
  });

  const formattedBalance = balance !== undefined && balance !== null
    ? parseFloat(formatUnits(balance as bigint, USDC_DECIMALS)).toFixed(2)
    : '0.00';

  return {
    balance: formattedBalance,
    rawBalance: balance,
    isLoading,
    refetch,
  };
}
