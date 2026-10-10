export interface ViewportPolicyInput { width: number; height: number; visualHeight?: number; keyboardOpen?: boolean; usePcFallback?: boolean }
export interface ViewportPolicy { mode: 'pc'; landscape: boolean; showGate: boolean; minWidth: 1100 }

export function resolveViewportPolicy(input: ViewportPolicyInput): ViewportPolicy {
  const referenceHeight = input.keyboardOpen && input.visualHeight !== undefined && input.visualHeight < input.height ? input.height : input.visualHeight ?? input.height
  const landscape = input.width >= referenceHeight
  return { mode: 'pc', landscape, showGate: !landscape && input.usePcFallback !== true, minWidth: 1100 }
}
