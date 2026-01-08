import * as bippy from 'bippy';
import { __VITE_REACT_MCP_TOOLS__, target } from './shared/const.js';
import { fiberRoots, store } from './shared/store.js';
import { highlightComponent } from './core/tools/component_highlighter.js';
import { getComponentStates } from './core/tools/component_state_viewer.js';
import { getComponentTree } from './core/tools/component_viewer.js';
import {
  collectUnnecessaryRender,
  queryWastedRender,
} from './core/tools/track_wasted_render.js';

const init = () => {
  if (Object.hasOwn(target, __VITE_REACT_MCP_TOOLS__)) {
    return;
  }

  Object.defineProperty(target, __VITE_REACT_MCP_TOOLS__, {
    value: {
      highlightComponent: highlightComponent,
      getComponentTree: getComponentTree,
      getComponentStates: getComponentStates,
      getUnnecessaryRenderedComponents: queryWastedRender,
    },
    writable: false,
    configurable: true,
  });
};

init();

bippy.instrument({
  name: 'vite-react-mcp',
  // TODO: frameify onCommitFiberRoot
  // every onCommit should record an auto increment id
  // and time. We then can query, between [start, end]
  // what happened, in junction with states changes
  // ALL of these are to answer the question:
  // hey, this component was waste rendered, so what happened?
  onCommitFiberRoot: (_renderId, root) => {
    if (fiberRoots.has(_renderId)) {
      fiberRoots.get(_renderId).add(root);
    } else {
      fiberRoots.set(_renderId, new Set([root]));
    }

    bippy.traverseRenderedFibers(root.current || root, (fiber, phase) => {
      if (phase === 'update') {
        collectUnnecessaryRender(fiber);
      }
    });

    store.currentCommitFrameId += 1;
  },
});

const setupMcpToolsHandler = () => {
  const hot = import.meta.hot as any;
  if (hot) {
    hot.on('highlight-component', (data: string) => {
      let deserializedData: { componentName?: string };
      try {
        deserializedData = JSON.parse(data);
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Data is not deserializable';
        throw new Error(`${message}: ${data}`);
      }
      if (typeof deserializedData?.componentName !== 'string') {
        throw new Error('Invalid args sent from ViteDevServer');
      }

      let response = 'Action failed';
      try {
        const components = target.__VITE_REACT_MCP_TOOLS__.highlightComponent(
          deserializedData.componentName,
        );
        if (components.length > 0) {
          response = `Found and highlighted ${components.length} components`;
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        response = `Error: ${message}`;
      }

      hot.send('highlight-component-response', response);
    });

    hot.on('get-component-tree', (data: string) => {
      let deserializedData: Record<string, unknown>;
      try {
        deserializedData = JSON.parse(data);
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Args is not deserializable';
        throw new Error(`${message}: ${data}`);
      }

      const componentTreeRoot =
        target.__VITE_REACT_MCP_TOOLS__.getComponentTree(deserializedData);
      console.log('get-component-tree-response', componentTreeRoot);
        hot.send(
        'get-component-tree-response',
        JSON.stringify(componentTreeRoot),
      );
    });

    hot.on('get-component-states', (data: string) => {
      let deserializedData: { componentName?: string };
      try {
        deserializedData = JSON.parse(data);
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Data is not deserializable';
        throw new Error(`${message}: ${data}`);
      }
      if (typeof deserializedData?.componentName !== 'string') {
        console.debug('get-component-states ws handler', deserializedData);
        throw new Error(
          'Invalid data sent from ViteDevServer: missing componentName',
        );
      }

      const componentStatesResult =
        target.__VITE_REACT_MCP_TOOLS__.getComponentStates(
          deserializedData.componentName,
        );
      hot.send(
        'get-component-states-response',
        JSON.stringify(componentStatesResult),
      );
    });

    hot.on('get-unnecessary-rerenders', (data: string) => {
      let deserializedData: { timeframe?: number; allComponents?: boolean; debugMode?: boolean };
      try {
        deserializedData = JSON.parse(data);
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Data is not deserializable';
        throw new Error(`${message}: ${data}`);
      }

      const wastedRenders =
        target.__VITE_REACT_MCP_TOOLS__.getUnnecessaryRenderedComponents(
          deserializedData.timeframe,
          {
            allComponents: !!deserializedData.allComponents,
            debugMode: !!deserializedData.debugMode,
          },
        );

      let response;

      try {
        response = JSON.stringify(wastedRenders);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('Error serializing wasted renders', error);
        response = JSON.stringify({ error: message });
      }

      hot.send('get-unnecessary-rerenders-response', response);
    });
  }
};

setupMcpToolsHandler();
