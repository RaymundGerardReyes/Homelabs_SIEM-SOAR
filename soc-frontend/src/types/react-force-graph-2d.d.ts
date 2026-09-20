// soc-frontend/src/types/react-force-graph-2d.d.ts
declare module 'react-force-graph-2d' {
  import React from 'react';

  export interface ForceGraphMethods {
    zoomToFit(duration?: number, padding?: number): void;
    centerAt(x?: number, y?: number, duration?: number): void;
    zoom(k?: number, duration?: number): void;
    [key: string]: any;
  }

  export interface ForceGraphProps {
    ref?: React.Ref<ForceGraphMethods | undefined>;
    width?: number;
    height?: number;
    graphData?: {
      nodes: any[];
      links: any[];
    };
    nodeId?: string;
    nodeLabel?: string | ((node: any) => string);
    nodeColor?: string | ((node: any) => string);
    nodeVal?: number | ((node: any) => number);
    nodeRelSize?: number;
    nodeCanvasObject?: (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => void;
    nodeCanvasObjectMode?: string | ((node: any) => string);
    linkLabel?: string | ((link: any) => string);
    linkColor?: string | ((link: any) => string);
    linkWidth?: number | ((link: any) => number);
    linkCurvature?: number | ((link: any) => number);
    linkDirectionalParticles?: number | ((link: any) => number);
    linkDirectionalParticleWidth?: number | ((link: any) => number);
    linkDirectionalParticleSpeed?: number | ((link: any) => number);
    linkLineDash?: (link: any) => number[] | null;
    onNodeClick?: (node: any, event?: MouseEvent) => void;
    onNodeRightClick?: (node: any, event?: MouseEvent) => void;
    onNodeHover?: (node: any | null, previousNode: any | null) => void;
    onNodeDrag?: (node: any, translate: { x: number; y: number }) => void;
    onNodeDragEnd?: (node: any, translate: { x: number; y: number }) => void;
    onLinkClick?: (link: any, event?: MouseEvent) => void;
    onBackgroundClick?: (event?: MouseEvent) => void;
    onZoom?: (transform: { k: number; x: number; y: number }) => void;
    d3AlphaDecay?: number;
    d3VelocityDecay?: number;
    cooldownTicks?: number;
    warmupTicks?: number;
    [key: string]: any;
  }

  const ForceGraph2D: React.ComponentType<ForceGraphProps>;
  export default ForceGraph2D;
}
