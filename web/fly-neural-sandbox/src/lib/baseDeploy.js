// "Claim Fly's Deployment": deploy a FlyCoin ERC-20 that stores the fly's
// Base44 DNA, from the visitor's own wallet (EIP-1193: Coinbase Wallet,
// MetaMask, ...), on Base.
//
// - Base Sepolia (testnet, no monetary value) is the only network enabled by
//   default. Base mainnet is compiled in only when the build sets
//   VITE_ALLOW_BASE_MAINNET=true, after legal / brand review.
// - Contract creation is a plain eth_sendTransaction without `to`. Smart-contract
//   wallets (e.g. Coinbase Smart Wallet) cannot CREATE this way; we detect the
//   failure and say so rather than retrying.
// - The contract (contracts/FlyCoin.sol) has no owner, mint or sale logic; the
//   fixed supply goes to the deployer and `dna` is immutable.

import artifact from './flycoin.artifact.json';

export const NETWORKS = {
  baseSepolia: {
    key: 'baseSepolia',
    label: 'Base Sepolia (testnet)',
    chainId: 84532,
    params: {
      chainId: '0x14a34',
      chainName: 'Base Sepolia',
      nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://sepolia.base.org'],
      blockExplorerUrls: ['https://sepolia.basescan.org'],
    },
    testnet: true,
  },
  base: {
    key: 'base',
    label: 'Base mainnet (real ETH)',
    chainId: 8453,
    params: {
      chainId: '0x2105',
      chainName: 'Base',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://mainnet.base.org'],
      blockExplorerUrls: ['https://basescan.org'],
    },
    testnet: false,
  },
};

/** Networks offered in the UI. Mainnet is opt-in at build time. */
export function enabledNetworks(env = import.meta.env ?? {}) {
  const list = [NETWORKS.baseSepolia];
  if (env.VITE_ALLOW_BASE_MAINNET === 'true') list.push(NETWORKS.base);
  return list;
}

// ---- minimal ABI encoding for constructor(string, string, string, uint256) ----

const utf8 = new TextEncoder();
const word = (n) => BigInt(n).toString(16).padStart(64, '0');

function encodeString(str) {
  const bytes = utf8.encode(str);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  const padded = hex.padEnd(Math.ceil(hex.length / 64) * 64, '0');
  return word(bytes.length) + padded;
}

/** ABI-encode (string name, string symbol, string dna, uint256 supply). */
export function encodeConstructorArgs(name, symbol, dna, supply) {
  const tails = [encodeString(name), encodeString(symbol), encodeString(dna)];
  const head = [];
  let offset = 4 * 32;
  for (const t of tails) {
    head.push(word(offset));
    offset += t.length / 2;
  }
  head.push(word(supply));
  return head.join('') + tails.join('');
}

/**
 * What would be deployed for a fly: token name/symbol/supply and the full
 * transaction data (bytecode + constructor args).
 */
export function flyCoinDeployment(dna, score) {
  const name = `FlyCoin ${dna}`;
  const symbol = 'FLY';
  // 1,000 tokens per point of score, at least 1,000; 18 decimals
  const whole = BigInt(Math.max(1, score)) * 1000n;
  const supply = whole * 10n ** 18n;
  const data = artifact.bytecode + encodeConstructorArgs(name, symbol, dna, supply);
  return { name, symbol, supply, supplyDisplay: whole.toLocaleString('en-US'), data, compiler: artifact.compiler };
}

// ---- wallet flow ----

export class DeployError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'DeployError';
    this.code = code;
  }
}

async function switchChain(provider, network) {
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: network.params.chainId }] });
  } catch (err) {
    // 4902: the wallet does not know this chain yet
    if (err?.code === 4902 || /unrecognized|unknown chain|not added/i.test(err?.message ?? '')) {
      await provider.request({ method: 'wallet_addEthereumChain', params: [network.params] });
    } else {
      throw err;
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Connect the wallet, switch to the network and send the contract-creation
 * transaction; resolves once the receipt is mined.
 * @param {object} provider  EIP-1193 provider (window.ethereum)
 * @param {{data:string}} deployment  from flyCoinDeployment()
 * @param {object} network  one of NETWORKS
 * @param {(stage:string)=>void} [onStage]
 */
export async function deployFlyCoin(provider, deployment, network, onStage = () => {}, { pollMs = 1500, timeoutMs = 180000 } = {}) {
  if (!provider?.request) throw new DeployError('No wallet found. Install Coinbase Wallet or MetaMask.', 'no-wallet');
  onStage('connect');
  const [from] = await provider.request({ method: 'eth_requestAccounts' });
  if (!from) throw new DeployError('The wallet did not share an account.', 'no-account');

  onStage('network');
  await switchChain(provider, network);
  const chainId = parseInt(await provider.request({ method: 'eth_chainId' }), 16);
  if (chainId !== network.chainId) throw new DeployError(`Wallet is on chain ${chainId}, expected ${network.chainId}.`, 'wrong-chain');

  onStage('sign');
  let hash;
  try {
    hash = await provider.request({ method: 'eth_sendTransaction', params: [{ from, data: deployment.data, value: '0x0' }] });
  } catch (err) {
    if (err?.code === 4001) throw new DeployError('You rejected the transaction.', 'rejected');
    if (err?.code === -32601 || /not supported|unsupported|contract creation/i.test(err?.message ?? '')) {
      throw new DeployError(
        'This wallet cannot deploy contracts directly (smart-contract wallets such as Coinbase Smart Wallet). Use a regular wallet account.',
        'smart-wallet',
      );
    }
    throw err;
  }

  onStage('mining');
  const started = Date.now();
  for (;;) {
    const receipt = await provider.request({ method: 'eth_getTransactionReceipt', params: [hash] });
    if (receipt) {
      if (receipt.status !== '0x1') throw new DeployError('The deployment transaction reverted.', 'reverted');
      const explorer = network.params.blockExplorerUrls[0];
      return {
        hash,
        address: receipt.contractAddress,
        from,
        txUrl: `${explorer}/tx/${hash}`,
        addressUrl: `${explorer}/address/${receipt.contractAddress}`,
      };
    }
    if (Date.now() - started > timeoutMs) throw new DeployError('Timed out waiting for the transaction to be mined.', 'timeout');
    await sleep(pollMs);
  }
}
