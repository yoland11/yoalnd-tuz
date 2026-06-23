# Thermal receipts — 58mm & 80mm

Use for: POS receipts, photography vouchers (وصل تصوير), kosha booking receipts,
payment/collection vouchers (سند قبض). Default 80mm; offer 58mm for narrow rolls.

Always style with `thermalReceiptCss("80mm")` (or `"58mm"`) from
`src/views/admin/print-helpers.ts`. It is purpose-built for thermal heads —
do **not** write your own thermal CSS.

## Physical constraints (why thermal is its own design)

- Thermal heads burn dots: only **pure black**, no grays, no anti-aliasing.
- Hairlines vanish — borders are **≥1.5px solid**, totals box **2.5px**.
- Roll height is unlimited but width is fixed → `@page { size: 80mm auto }`,
  page height follows content, margins near zero.
- Money uses `tabular-nums` (the `.num` class) so digits align in a column.

## Type scale (relative to base — 13px@80mm / 12px@58mm)

- Company name `.r-company` — 1.65em, weight 900
- Document title — ~1.0em, weight 800
- Meta rows `.kv` — 1.0em, weight 700/800
- Grand total `.grand` — 1.35em, weight 900, boxed (2.5px)
- Remaining `.payline.remain` — 1.2em, boxed (1.5px)

## Canonical skeleton

Mark up with the toolkit classes; never reinvent class names.

```html
<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>${title}</title>
<style>${thermalReceiptCss("80mm")}</style></head>
<body>
  <div class="receipt">
    <div class="r-head">
      <img class="r-logo" src="${logo}" alt="">
      <div class="r-company">مجموعة علي جان نهاد</div>
      <div class="r-sub">${docTitle}</div>            <!-- وصل تصوير / سند قبض / فاتورة -->
      <div class="r-sub num">${number} · ${date}</div>
    </div>
    <hr class="rule">

    <div class="kv"><span>الزبون</span><span class="v">${customer}</span></div>
    <div class="kv"><span>الهاتف</span><span class="v num">${phone || "غير مسجل"}</span></div>
    <!-- document-specific meta rows go here (المناسبة، الكوشة، المصور …) -->
    <hr class="rule dashed">

    <table class="items">
      <thead><tr><th class="name">الصنف</th><th>الكمية</th><th>السعر</th><th>المبلغ</th></tr></thead>
      <tbody>
        <tr><td class="name">${item}</td><td class="num">${qty}</td><td class="num">${price}</td><td class="num">${line}</td></tr>
      </tbody>
    </table>

    <div class="totals">
      <div class="grand"><span>الإجمالي</span><span class="num">${total} د.ع</span></div>
      <div class="payline"><span>المدفوع</span><span class="num">${paid} د.ع</span></div>
      <div class="payline remain"><span>المتبقي</span><span class="num">${remaining} د.ع</span></div>
    </div>

    <div class="qr"><img src="${qrDataUrl}"><div class="cap num">${trackCode}</div></div>
    <div class="thanks">شكراً لاختياركم مجموعة علي جان نهاد</div>
  </div>
  ${printWhenImagesReadyScript()}
</body></html>
```

Adapt the meta rows and the items/totals to the document (a voucher may have no
items table — just meta + totals). Keep the header, totals hierarchy, QR, and
thanks line consistent so every thermal print is recognizably AJN.

## Single-item / voucher variant

For vouchers without a line-item table (photography, kosha, payment), drop
`table.items` and present details as `.kv` rows, keeping the same header and the
boxed `.grand` / `.payline.remain` totals block. This is what the photography
`printReceipt` should become — same fields it prints today, restyled through
`thermalReceiptCss`.
