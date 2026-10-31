/** 内置示例图（F-002），随静态资源一并部署，可离线游玩 */
export interface SampleDef {
  name: string;
  url: string;
}

const asset = (file: string): string => `${import.meta.env.BASE_URL}samples/${file}`;

export const SAMPLES: SampleDef[] = [
  { name: '落日山脉', url: asset('sample-01.svg') },
  { name: '碧海晴空', url: asset('sample-02.svg') },
  { name: '几何拼色', url: asset('sample-03.svg') },
  { name: '热气球之旅', url: asset('sample-04.svg') },
];
