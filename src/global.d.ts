import type { WastedRenderFiberInfo } from './types/internal';

declare global {
  interface Window {
    __REACT_COMPONENTS__: string[];
    __VITE_REACT_MCP_TOOLS__: {
      highlightReactComponent: (
        componentName: string,
        options: { debugMode?: boolean },
      ) => void;
      getComponentTree: (options: {
        selfOnly: boolean;
        debugMode?: boolean;
      }) => any;
      getComponentStates: (options: { debugMode?: boolean }) => any;
      getUnnecessaryRenderedComponents: (options: {
        debugMode?: boolean;
      }) => WastedRenderFiberInfo[];
    };
  }

  /**
   * Bun's global ImportMeta.hot typing expects a `decline()` method, while Vite's
   * `ViteHotContext` does not declare it. We add it here to satisfy Bun's
   * widened ImportMeta type when compiling with bun/tsc.
   */
  interface ImportMetaHot {
    decline(): void;
  }
}

declare module 'vite' {
  interface ViteHotContext {
    decline(): void;
  }
}

declare module 'vite/types/hmr' {
  interface ViteHotContext {
    decline(): void;
  }
}

declare module 'vite/runtime/client' {
  interface ViteHotContext {
    decline(): void;
  }
}
