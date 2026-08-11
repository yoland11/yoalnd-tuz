export type AgentConfig = {
  baseUrl: string;
  agentId: string;
  agentToken: string;
};

export type PrinterInfo = { name: string; displayName?: string; isDefault?: boolean };

export type PrintPayload = {
  schemaVersion: 1;
  documentType: "sales_invoice";
  paperSize: "80mm" | "58mm";
  printerName: string;
  horizontalOffsetMm?: string;
  verticalOffsetMm?: string;
  appearance?: {
    logoUrl: string | null;
    companyName: string | null;
    companyPhone: string | null;
    companyAddress: string | null;
    footerText: string;
    showLogo: boolean;
    showQr: boolean;
    showCustomerPhone: boolean;
    showEmployeeName: boolean;
    showAddress: boolean;
  };
  invoice: {
    invoiceNo: string;
    date: string;
    issuedAt?: string;
    customerName: string;
    customerPhone: string | null;
    paymentMethod: string;
    paymentStatus: string;
    subtotal: string;
    discountAmount: string;
    taxAmount: string;
    deliveryFee?: string;
    total: string;
    paidAmount: string;
    remainingAmount: string;
    notes: string | null;
    employeeName: string | null;
    items: Array<{ name: string; quantity: string; unitPrice: string; total: string }>;
    qrUrl: string | null;
  };
};

export type PrintJob = { id: number; jobNo: string; status: string; paperSize: "80mm" | "58mm"; copies: number; payload: PrintPayload };
