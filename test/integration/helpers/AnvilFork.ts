import { spawn, type ChildProcess } from 'child_process';
import { createPublicClient, http } from 'viem';
import { anvil as anvilChain } from 'viem/chains';

/**
 * Manages a local Anvil EVM instance for integration tests.
 *
 * Usage:
 * ```ts
 * const anvil = new AnvilFork();
 * await anvil.start();
 * // ... tests ...
 * await anvil.stop();
 * ```
 */
export class AnvilFork {
  private _process: ChildProcess | null = null;
  private readonly _port: number;
  private readonly _forkUrl: string | undefined;

  constructor(options: AnvilOptions = {}) {
    // Randomize port to allow parallel test runs
    this._port = options.port ?? (8545 + Math.floor(Math.random() * 1000));
    this._forkUrl = options.forkUrl;
  }

  get rpcUrl(): string {
    return `http://127.0.0.1:${this._port}`;
  }

  get chain() {
    return {
      ...anvilChain,
      id: 31337,
      rpcUrls: {
        default: { http: [this.rpcUrl] },
        public: { http: [this.rpcUrl] },
      },
    };
  }

  async start(): Promise<void> {
    const args = ['--port', String(this._port), '--silent'];
    if (this._forkUrl) {
      args.push('--fork-url', this._forkUrl);
    }

    this._process = spawn('anvil', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Wait for Anvil to be ready
    await this._waitReady();
  }

  async stop(): Promise<void> {
    if (this._process) {
      this._process.kill('SIGTERM');
      this._process = null;
      await delay(100);
    }
  }

  /**
   * Fast-forward EVM time by `seconds`.
   * Used to skip challenge periods in dispute tests.
   */
  async increaseTime(seconds: number): Promise<void> {
    await this._rpc('evm_increaseTime', [seconds]);
    await this._rpc('evm_mine', []);
  }

  /**
   * Mine a specific number of blocks.
   */
  async mine(blocks = 1): Promise<void> {
    await this._rpc('evm_mine', Array(blocks).fill(null));
  }

  /**
   * Take an EVM snapshot (save state).
   */
  async snapshot(): Promise<string> {
    const result = await this._rpc('evm_snapshot', []);
    return result as string;
  }

  /**
   * Restore an EVM snapshot.
   */
  async revert(snapshotId: string): Promise<void> {
    await this._rpc('evm_revert', [snapshotId]);
  }

  /**
   * Get the current block number.
   */
  async blockNumber(): Promise<number> {
    const client = createPublicClient({ transport: http(this.rpcUrl) });
    return Number(await client.getBlockNumber());
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private async _waitReady(attempts = 30): Promise<void> {
    for (let i = 0; i < attempts; i++) {
      try {
        await this._rpc('eth_chainId', []);
        return;
      } catch {
        await delay(200);
      }
    }
    throw new Error(`AnvilFork: could not connect to Anvil on port ${this._port} after ${attempts} attempts`);
  }

  private async _rpc(method: string, params: unknown[]): Promise<unknown> {
    const response = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const data = await response.json() as { result?: unknown; error?: { message: string } };
    if (data.error) throw new Error(data.error.message);
    return data.result;
  }
}

export interface AnvilOptions {
  port?: number;
  forkUrl?: string;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
