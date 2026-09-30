import { createVM } from '@ethereumjs/vm';
import { Address, bytesToHex, hexToBytes } from '@ethereumjs/util';
import { describe, expect, it } from 'vitest';

import { deployFlyCoin, enabledNetworks, flyCoinDeployment, NETWORKS } from './baseDeploy.js';

import artifact from './flycoin.artifact.json';

// function selectors straight from solc's method identifiers
const ids = artifact.methodIdentifiers;
const SEL = {
  name: ids['name()'],
  symbol: ids['symbol()'],
  decimals: ids['decimals()'],
  totalSupply: ids['totalSupply()'],
  dna: ids['dna()'],
  balanceOf: ids['balanceOf(address)'],
};

const decodeString = (hex) => {
  const h = hex.replace(/^0x/, '');
  const len = parseInt(h.slice(64, 128), 16);
  return new TextDecoder().decode(hexToBytes(`0x${h.slice(128, 128 + len * 2)}`));
};

describe('FlyCoin contract (real EVM)', () => {
  it('deploys from the artifact and stores the DNA, name, symbol and supply', async () => {
    const vm = await createVM();
    const deployer = new Address(hexToBytes('0x00000000000000000000000000000000000f1ee5'));
    const d = flyCoinDeployment('D8HR0T6Ncc', 6);
    const created = await vm.evm.runCall({ caller: deployer, data: hexToBytes(d.data), gasLimit: 5_000_000n });
    expect(created.execResult.exceptionError).toBeUndefined();
    const token = created.createdAddress;
    const call = async (sel, arg = '') => {
      const r = await vm.evm.runCall({ caller: deployer, to: token, data: hexToBytes(`0x${sel}${arg}`), gasLimit: 200_000n });
      expect(r.execResult.exceptionError).toBeUndefined();
      return bytesToHex(r.execResult.returnValue);
    };
    expect(decodeString(await call(SEL.name))).toBe('FlyCoin D8HR0T6Ncc');
    expect(decodeString(await call(SEL.symbol))).toBe('FLY');
    expect(decodeString(await call(SEL.dna))).toBe('D8HR0T6Ncc');
    expect(BigInt(await call(SEL.decimals))).toBe(18n);
    expect(BigInt(await call(SEL.totalSupply))).toBe(6000n * 10n ** 18n);
    const bal = await call(SEL.balanceOf, deployer.toString().slice(2).padStart(64, '0'));
    expect(BigInt(bal)).toBe(6000n * 10n ** 18n);
  });
});

describe('deploy flow (mock EIP-1193 wallet)', () => {
  const mockWallet = (overrides = {}) => {
    const calls = [];
    let chain = '0x1';
    const provider = {
      calls,
      async request({ method, params }) {
        calls.push({ method, params });
        if (overrides[method]) return overrides[method](params);
        switch (method) {
          case 'eth_requestAccounts':
            return ['0xabc0000000000000000000000000000000000001'];
          case 'wallet_switchEthereumChain': {
            const err = new Error('Unrecognized chain ID');
            err.code = 4902;
            throw err;
          }
          case 'wallet_addEthereumChain':
            chain = params[0].chainId;
            return null;
          case 'eth_chainId':
            return chain;
          case 'eth_sendTransaction':
            return '0xfeed';
          case 'eth_getTransactionReceipt':
            return { status: '0x1', contractAddress: '0xc0ffee0000000000000000000000000000000001' };
          default:
            throw new Error(`unexpected ${method}`);
        }
      },
    };
    return provider;
  };

  it('adds Base Sepolia when unknown, sends a creation tx with the exact data, returns the explorer links', async () => {
    const wallet = mockWallet();
    const d = flyCoinDeployment('D8HR0T6Ncc', 6);
    const stages = [];
    const res = await deployFlyCoin(wallet, d, NETWORKS.baseSepolia, (s) => stages.push(s), { pollMs: 1 });
    expect(stages).toEqual(['connect', 'network', 'sign', 'mining']);
    const add = wallet.calls.find((c) => c.method === 'wallet_addEthereumChain');
    expect(add.params[0].chainId).toBe('0x14a34');
    const tx = wallet.calls.find((c) => c.method === 'eth_sendTransaction').params[0];
    expect(tx.to).toBeUndefined();
    expect(tx.data).toBe(d.data);
    expect(res.addressUrl).toBe('https://sepolia.basescan.org/address/0xc0ffee0000000000000000000000000000000001');
  });

  it('explains smart-wallet and rejection failures', async () => {
    const d = flyCoinDeployment('D8HR0T6Ncc', 1);
    const smart = mockWallet({
      eth_sendTransaction: () => {
        const e = new Error('Method not supported');
        e.code = -32601;
        throw e;
      },
    });
    await expect(deployFlyCoin(smart, d, NETWORKS.baseSepolia, undefined, { pollMs: 1 })).rejects.toMatchObject({ code: 'smart-wallet' });
    const reject = mockWallet({
      eth_sendTransaction: () => {
        const e = new Error('User rejected');
        e.code = 4001;
        throw e;
      },
    });
    await expect(deployFlyCoin(reject, d, NETWORKS.baseSepolia, undefined, { pollMs: 1 })).rejects.toMatchObject({ code: 'rejected' });
    await expect(deployFlyCoin(null, d, NETWORKS.baseSepolia)).rejects.toMatchObject({ code: 'no-wallet' });
  });

  it('offers only the testnet unless mainnet is explicitly enabled at build time', () => {
    expect(enabledNetworks({}).map((n) => n.key)).toEqual(['baseSepolia']);
    expect(enabledNetworks({ VITE_ALLOW_BASE_MAINNET: 'true' }).map((n) => n.key)).toEqual(['baseSepolia', 'base']);
  });
});
