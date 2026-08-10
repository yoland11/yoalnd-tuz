export {};
declare global { interface Window { agent: { status(): Promise<{ status: string; configured: boolean }>; register(input: { baseUrl: string; agentId: string; registrationToken: string }): Promise<unknown>; testPrint(): Promise<{ printerName: string }>; }; } }
