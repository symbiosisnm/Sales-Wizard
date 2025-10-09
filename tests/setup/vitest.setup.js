// Provide a predictable salesWizard runtime flag for components that check platform details.
if (!globalThis.window) {
  globalThis.window = globalThis;
}

globalThis.window.salesWizard = { isMacOS: false };
