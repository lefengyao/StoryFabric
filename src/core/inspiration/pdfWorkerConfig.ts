let workerSource: string | undefined

/** Browser entrypoints supply a bundled worker URL; Node keeps pdf.js defaults. */
export function configurePdfWorker(source: string): void { workerSource = source }
export function pdfWorkerSource(): string | undefined { return workerSource }
