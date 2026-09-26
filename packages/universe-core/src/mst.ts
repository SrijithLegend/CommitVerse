/** §3.5 constellation lines: minimum spanning tree of member positions (never a complete graph). */
type P = [number, number, number];

/** Prim's MST, O(n²) — n ≤ 64. Returns index pairs. */
export function minimumSpanningTree(points: P[]): [number, number][] {
  const n = points.length;
  if (n < 2) return [];
  const inTree = new Array<boolean>(n).fill(false);
  const best = new Array<number>(n).fill(Number.POSITIVE_INFINITY);
  const parent = new Array<number>(n).fill(-1);
  best[0] = 0;
  const edges: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!inTree[i] && (u === -1 || best[i]! < best[u]!)) u = i;
    inTree[u] = true;
    if (parent[u]! >= 0) edges.push([parent[u]!, u]);
    for (let v = 0; v < n; v++) {
      if (inTree[v]) continue;
      const a = points[u]!;
      const b = points[v]!;
      const d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
      if (d < best[v]!) {
        best[v] = d;
        parent[v] = u;
      }
    }
  }
  return edges;
}
