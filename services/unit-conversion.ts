export interface UnitHierarchyInput {
  unit_name: string;
  parent_unit_name: string;
  quantity_per_parent: number;
}

export interface UnitDefinitionLike {
  unit_name: string;
  conversion_factor: number;
}

const FRACTIONAL_UNIT_NAMES = new Set([
  'ml', 'milliliter', 'millilitre', 'l', 'liter', 'litre',
  'g', 'gm', 'gram', 'grams', 'mg', 'milligram', 'milligrams', 'kg', 'kilogram', 'kilograms',
  'مل', 'مليلتر', 'ملليلتر', 'لتر', 'جم', 'غ', 'غم', 'مجم', 'ملجم', 'كغ', 'كجم',
]);

export function unitAllowsFractionalQuantity(unitName: string): boolean {
  return FRACTIONAL_UNIT_NAMES.has(unitName.trim().toLocaleLowerCase('en').replace(/\s+/g, ''));
}

export function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isValidUnitQuantity(quantity: number, unitName: string, allowZero = false): boolean {
  if (!Number.isFinite(quantity) || (allowZero ? quantity < 0 : quantity <= 0)) return false;
  return unitAllowsFractionalQuantity(unitName) || Number.isInteger(quantity);
}

export type UnitFactorResult =
  | { ok: true; factors: Record<string, number> }
  | { ok: false; error: string };

/** Calculates each unit's absolute quantity in the one authoritative base unit. */
export function deriveUnitFactors(baseUnit: string, units: UnitHierarchyInput[]): UnitFactorResult {
  const base = baseUnit.trim();
  if (!base) return { ok: false, error: 'أدخل اسم وحدة المخزون الأساسية' };

  const names = new Set<string>([base]);
  for (const unit of units) {
    const name = unit.unit_name.trim();
    if (!name) return { ok: false, error: 'أدخل اسم كل وحدة مضافة' };
    if (names.has(name)) return { ok: false, error: `اسم الوحدة مكرر: ${name}` };
    names.add(name);
    if (!Number.isFinite(unit.quantity_per_parent) || unit.quantity_per_parent <= 0) {
      return { ok: false, error: `أدخل كمية صحيحة موجبة في ${name}` };
    }
  }

  const byName = new Map(units.map(unit => [unit.unit_name.trim(), unit]));
  const factors: Record<string, number> = { [base]: 1 };
  const visiting = new Set<string>();
  const resolve = (name: string): number | null => {
    if (Object.prototype.hasOwnProperty.call(factors, name)) return factors[name];
    const unit = byName.get(name);
    if (!unit) return null;
    if (visiting.has(name)) return null;
    const parent = unit.parent_unit_name.trim();
    if (!parent || !names.has(parent)) return null;
    visiting.add(name);
    const parentFactor = resolve(parent);
    visiting.delete(name);
    if (parentFactor === null) return null;
    const factor = parentFactor * unit.quantity_per_parent;
    if (!Number.isFinite(factor) || factor <= 0) return null;
    factors[name] = factor;
    return factor;
  };

  for (const unit of units) {
    const name = unit.unit_name.trim();
    if (resolve(name) === null) return { ok: false, error: `علاقة الوحدة ${name} غير صحيحة أو دائرية` };
  }
  return { ok: true, factors };
}

/** Converts an entered quantity to the product's authoritative base unit. */
export function toBaseQuantity(quantity: number, conversionFactor: number): number {
  if (!Number.isFinite(quantity) || quantity < 0) throw new Error('الكمية يجب أن تكون صفرًا أو أكبر');
  if (!Number.isFinite(conversionFactor) || conversionFactor <= 0) throw new Error('معامل التحويل يجب أن يكون أكبر من صفر');
  return quantity * conversionFactor;
}

/** Derives a unit price from a base-unit price, unless a unit override exists. */
export function priceForUnit(basePrice: number, conversionFactor: number, override?: number | null): number {
  if (override !== undefined && override !== null) return override;
  return basePrice * conversionFactor;
}

/** Shows the selected quantity in every configured unit at or below its level. */
export function formatUnitEquivalents(
  quantity: number,
  selectedUnit: string,
  baseUnit: string,
  units: UnitDefinitionLike[],
): { quantity: number; unit: string }[] {
  const selected = units.find(unit => unit.unit_name === selectedUnit);
  if (!selected || !Number.isFinite(quantity) || quantity < 0) return [];
  const baseQuantity = quantity * selected.conversion_factor;
  const levels = [...units]
    .filter(unit => unit.conversion_factor <= selected.conversion_factor + 1e-10 && unit.conversion_factor > 0)
    .sort((a, b) => b.conversion_factor - a.conversion_factor || a.unit_name.localeCompare(b.unit_name));
  const distinctLevels = levels.filter((unit, index) => index === 0 || Math.abs(unit.conversion_factor - levels[index - 1].conversion_factor) > 1e-10);
  if (!distinctLevels.some(unit => unit.unit_name === baseUnit)) {
    distinctLevels.push({ unit_name: baseUnit, conversion_factor: 1 });
  }
  return distinctLevels.map(unit => ({ quantity: baseQuantity / unit.conversion_factor, unit: unit.unit_name }));
}

/** Represents one base balance as the largest configured units plus its remainder. */
export function decomposeBaseQuantity(
  quantity: number,
  baseUnit: string,
  units: UnitDefinitionLike[],
): { quantity: number; unit: string }[] {
  if (!Number.isFinite(quantity) || quantity < 0) return [];
  const candidates = units
    .filter(unit => unit.unit_name !== baseUnit && Number.isFinite(unit.conversion_factor) && unit.conversion_factor > 1)
    .sort((a, b) => b.conversion_factor - a.conversion_factor || a.unit_name.localeCompare(b.unit_name));
  const result: { quantity: number; unit: string }[] = [];
  let remainder = quantity;
  for (const unit of candidates) {
    const count = Math.floor((remainder + Number.EPSILON * Math.max(1, remainder)) / unit.conversion_factor);
    if (count > 0) {
      result.push({ quantity: count, unit: unit.unit_name });
      remainder -= count * unit.conversion_factor;
      if (Math.abs(remainder) < 1e-10) remainder = 0;
    }
  }
  if (remainder > 0 || result.length === 0) result.push({ quantity: remainder, unit: baseUnit });
  return result;
}

export function formatUnitBreakdown(
  quantity: number,
  baseUnit: string,
  units: UnitDefinitionLike[],
): string[] {
  return decomposeBaseQuantity(quantity, baseUnit, units).map(part => `${part.quantity} ${part.unit}`);
}
