// Minimal little-endian Borsh reader/writer for the fixed-layout account data
// and instruction args of tapclash_pools. The program uses only u8/u16/u32/u64,
// bool, Pubkey and fixed arrays — no Vec/String — so a tiny hand-rolled codec is
// enough and keeps the SDK free of heavy Anchor runtime deps (RN/Hermes-safe).

import { PublicKey } from '@solana/web3.js';

export class Writer {
  private bytes: number[] = [];

  u8(n: number): this {
    this.bytes.push(n & 0xff);
    return this;
  }

  u16(n: number): this {
    this.bytes.push(n & 0xff, (n >>> 8) & 0xff);
    return this;
  }

  u32(n: number): this {
    const v = n >>> 0;
    this.bytes.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
    return this;
  }

  u64(n: bigint | number): this {
    let v = BigInt(n);
    if (v < 0n) throw new Error('u64 cannot be negative');
    for (let i = 0; i < 8; i++) {
      this.bytes.push(Number(v & 0xffn));
      v >>= 8n;
    }
    return this;
  }

  raw(arr: ArrayLike<number>): this {
    for (let i = 0; i < arr.length; i++) this.bytes.push(arr[i] & 0xff);
    return this;
  }

  toBuffer(): Buffer {
    return Buffer.from(this.bytes);
  }
}

export class Reader {
  offset = 0;
  constructor(private readonly data: Uint8Array) {}

  u8(): number {
    return this.data[this.offset++];
  }

  u16(): number {
    const v = this.data[this.offset] | (this.data[this.offset + 1] << 8);
    this.offset += 2;
    return v & 0xffff;
  }

  u32(): number {
    const d = this.data;
    const o = this.offset;
    const v = (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
    this.offset += 4;
    return v;
  }

  u64(): bigint {
    let v = 0n;
    for (let i = 0; i < 8; i++) v |= BigInt(this.data[this.offset + i]) << (8n * BigInt(i));
    this.offset += 8;
    return v;
  }

  bool(): boolean {
    return this.u8() !== 0;
  }

  pubkey(): PublicKey {
    const slice = this.data.slice(this.offset, this.offset + 32);
    this.offset += 32;
    return new PublicKey(slice);
  }

  skip(n: number): this {
    this.offset += n;
    return this;
  }
}
