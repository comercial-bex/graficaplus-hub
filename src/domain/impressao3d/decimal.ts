export class Decimal {
  private readonly cents: bigint;
  private readonly scale: bigint;

  private constructor(value: bigint, scale = 1_000_000n) {
    this.cents = value;
    this.scale = scale;
  }

  static from(value: Decimal | string | number | bigint) {
    if (value instanceof Decimal) return value;
    if (typeof value === "bigint") return new Decimal(value * 1_000_000n);
    const text = String(value).replace(",", ".").trim();
    const negative = text.startsWith("-");
    const [i, f = ""] = text.replace("-", "").split(".");
    const frac = (f + "000000").slice(0, 6);
    const raw = BigInt(i || "0") * 1_000_000n + BigInt(frac);
    return new Decimal(negative ? -raw : raw);
  }

  add(v: Decimal | string | number | bigint) { return new Decimal(this.cents + Decimal.from(v).cents); }
  sub(v: Decimal | string | number | bigint) { return new Decimal(this.cents - Decimal.from(v).cents); }
  mul(v: Decimal | string | number | bigint) { return new Decimal((this.cents * Decimal.from(v).cents) / this.scale); }
  div(v: Decimal | string | number | bigint) {
    const divisor = Decimal.from(v).cents;
    if (divisor === 0n) throw new Error("Divisão por zero");
    return new Decimal((this.cents * this.scale) / divisor);
  }
  gt(v: Decimal | string | number | bigint) { return this.cents > Decimal.from(v).cents; }
  gte(v: Decimal | string | number | bigint) { return this.cents >= Decimal.from(v).cents; }
  lt(v: Decimal | string | number | bigint) { return this.cents < Decimal.from(v).cents; }
  lte(v: Decimal | string | number | bigint) { return this.cents <= Decimal.from(v).cents; }
  eq(v: Decimal | string | number | bigint) { return this.cents === Decimal.from(v).cents; }
  round(decimals = 2) {
    const factor = 10n ** BigInt(6 - decimals);
    const sign = this.cents < 0n ? -1n : 1n;
    const abs = this.cents * sign;
    return new Decimal(((abs + factor / 2n) / factor) * factor * sign);
  }
  toNumber() { return Number(this.cents) / 1_000_000; }
  toString(decimals = 4) { return this.toNumber().toFixed(decimals); }
}
export const D = Decimal.from;
