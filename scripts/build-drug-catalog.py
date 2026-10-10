#!/usr/bin/env python3
"""Build the offline catalog and Supabase seed CSV from the supplied catalog ZIP.

Only the explicitly normalized trade-name fields are exported. Original source
name columns, prices, stock thresholds, dose/indication text and source paths are
intentionally omitted.
"""
from __future__ import annotations

import csv
import json
import sys
import zipfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
JSON_OUT = ROOT / "assets" / "drug-catalog.json"
CSV_OUT = ROOT / "supabase" / "seed" / "drug_catalog.csv"
CSV_FIELDS = [
    "source_id", "source_code", "trade_name_ar", "trade_name_en",
    "generic_name", "active_ingredient", "strength", "dosage_form",
    "base_unit", "selling_unit", "pack_size", "category_id",
    "category_ar", "category_en", "manufacturer_id", "manufacturer_name",
    "country_of_origin", "is_active",
]


def text(value: Any) -> str | None:
    if value is None:
        return None
    value = str(value).strip()
    return value or None


def main() -> int:
    if len(sys.argv) != 2:
        print(f"Usage: {Path(sys.argv[0]).name} <source_catalog.zip>", file=sys.stderr)
        return 2

    source = Path(sys.argv[1]).expanduser().resolve()
    if not source.is_file():
        raise SystemExit(f"Source ZIP not found: {source}")

    with zipfile.ZipFile(source) as archive:
        candidates = [name for name in archive.namelist() if name.lower().endswith(".json") and "catalog" in name.lower()]
        if len(candidates) != 1:
            candidates = [name for name in archive.namelist() if name.lower().endswith(".json")]
        if len(candidates) != 1:
            raise SystemExit(f"Expected one catalog JSON in ZIP, found {len(candidates)}")
        source_data = json.loads(archive.read(candidates[0]).decode("utf-8-sig"))

    categories = {str(row.get("id")): row for row in source_data.get("categories", [])}
    records: list[dict[str, Any]] = []
    missing_trade_names: list[str] = []

    for product in source_data.get("products", []):
        source_id = text(product.get("id"))
        source_code = text(product.get("internal_code"))
        trade_name_ar = text(product.get("trade_name_ar"))
        trade_name_en = text(product.get("trade_name_en"))
        if not source_id or not source_code or not trade_name_ar:
            missing_trade_names.append(source_code or source_id or "<unknown>")
            continue

        category = categories.get(str(product.get("category_id")), {})
        pack_size = product.get("pack_size")
        try:
            pack_size = float(pack_size) if pack_size not in (None, "") else None
        except (TypeError, ValueError):
            pack_size = None
        if pack_size is not None and pack_size < 0:
            pack_size = None
        if pack_size is not None and pack_size.is_integer():
            pack_size = int(pack_size)

        records.append({
            "source_id": source_id,
            "source_code": source_code,
            "trade_name_ar": trade_name_ar,
            "trade_name_en": trade_name_en,
            "generic_name": text(product.get("generic_name")),
            "active_ingredient": text(product.get("active_ingredient")),
            "strength": text(product.get("strength")),
            "dosage_form": text(product.get("dosage_form")),
            "base_unit": text(product.get("base_unit")),
            "selling_unit": text(product.get("selling_unit")),
            "pack_size": pack_size,
            "category_id": text(product.get("category_id")),
            "category_ar": text(category.get("name_ar")),
            "category_en": text(category.get("name_en")),
            "manufacturer_id": text(product.get("manufacturer_id")),
            "manufacturer_name": text(product.get("manufacturer_name")),
            "country_of_origin": text(product.get("country_of_origin")),
            "is_active": bool(product.get("is_active", True)),
        })

    if missing_trade_names:
        raise SystemExit(f"Refusing to fall back to original source names; missing modified trade_name_ar for {len(missing_trade_names)} rows")

    ids = [row["source_id"] for row in records]
    codes = [row["source_code"] for row in records]
    if len(ids) != len(set(ids)) or len(codes) != len(set(codes)):
        raise SystemExit("Duplicate source IDs or codes detected; refusing to merge records")

    JSON_OUT.parent.mkdir(parents=True, exist_ok=True)
    CSV_OUT.parent.mkdir(parents=True, exist_ok=True)
    JSON_OUT.write_text(json.dumps({"schema_version": 1, "products": records}, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    with CSV_OUT.open("w", newline="", encoding="utf-8-sig") as output:
        writer = csv.DictWriter(output, fieldnames=CSV_FIELDS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(records)

    print(f"records={len(records)}")
    print(f"unique_trade_names_ar={len({row['trade_name_ar'] for row in records})}")
    print(f"JSON={JSON_OUT} ({JSON_OUT.stat().st_size} bytes)")
    print(f"CSV={CSV_OUT} ({CSV_OUT.stat().st_size} bytes)")
    print("excluded_fields=name_ar,name_en,original_dose,disease_indication,current_purchase_price,current_selling_price,min_stock_level,reorder_level,source_file,source_page,source_row")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
