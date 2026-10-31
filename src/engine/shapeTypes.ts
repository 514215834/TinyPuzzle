/** 形状生成器的数据结构（F-301） */
export interface EdgeParams {
  /** 凸舌朝向（+u / -u），相邻块共享同一边因此天然互补 */
  sign: 1 | -1;
  /** 凸舌中心沿边位置（0-1） */
  c: number;
  /** 颈宽（0-1，占边长） */
  w: number;
  /** 凸舌高度（0-1，占 S = min(cellW, cellH)） */
  h: number;
}

export interface ShapeSpec {
  rows: number;
  cols: number;
  stageW: number;
  stageH: number;
  /** 拼块位图四周的留白（px），容纳凸出的舌 */
  margin: number;
  /** 水平边参数：(rows+1) × cols；边界行为 null */
  hEdges: (EdgeParams | null)[][];
  /** 垂直边参数：rows × (cols+1)；边界列为 null */
  vEdges: (EdgeParams | null)[][];
}
