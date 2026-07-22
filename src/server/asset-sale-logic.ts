export type AssetSaleEligibilityInput = {
  status: string;
  isActive: boolean;
  alreadySold: boolean;
  assignedToEmployee: boolean;
  inCustodyGroup: boolean;
  reservedInBooking: boolean;
  linkedToActiveBooking: boolean;
};

const money = (value: unknown) => {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.round(Math.max(0, amount) * 100) / 100 : 0;
};

export function calculateAssetSaleOutcome(input: {
  bookValue: number;
  salePrice: number;
  paidAmount: number;
}) {
  const bookValue = money(input.bookValue);
  const salePrice = money(input.salePrice);
  const paidAmount = Math.min(salePrice, money(input.paidAmount));
  return {
    bookValue,
    salePrice,
    paidAmount,
    receivableAmount: money(salePrice - paidAmount),
    profitAmount: money(Math.max(0, salePrice - bookValue)),
    lossAmount: money(Math.max(0, bookValue - salePrice)),
  };
}

export function assetSaleEligibility(input: AssetSaleEligibilityInput) {
  const blockers: string[] = [];
  if (input.alreadySold || input.status === "sold") blockers.push("تم بيع هذا الأصل مسبقًا ولا يمكن إنشاء عملية بيع أخرى.");
  if (!input.isActive) blockers.push("الأصل غير نشط في سجل المنتجات.");
  if (["retired", "disposed"].includes(input.status)) blockers.push("الأصل مستبعد أو متصرف به ولا يمكن بيعه.");
  else if (input.status === "maintenance") blockers.push("الأصل تحت الصيانة؛ أكمل الصيانة وأعده إلى الحالة النشطة أولًا.");
  else if (input.status !== "active" && input.status !== "sold") blockers.push(`حالة الأصل الحالية (${input.status}) لا تسمح بالبيع.`);
  if (input.assignedToEmployee) blockers.push("الأصل بعهدة موظف أو لديه حركة إخراج مفتوحة؛ يجب تسجيل الإرجاع أولًا.");
  if (input.inCustodyGroup) blockers.push("الأصل مخصص ضمن مجموعة عهدة موظف؛ أزل التخصيص قبل البيع.");
  if (input.reservedInBooking) blockers.push("الأصل محجوز أو خارج ضمن حجز نشط؛ يجب إكمال الإرجاع والفحص أولًا.");
  if (input.linkedToActiveBooking) blockers.push("الأصل مرتبط حاليًا بحجز أو طلب قيد التنفيذ.");
  return { allowed: blockers.length === 0, blockers };
}
