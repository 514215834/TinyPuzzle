/** 内置示例图（F-002），随静态资源一并部署，可离线游玩；name 为 i18n key（F-403） */
export interface SampleDef {
  id: string;
  url: string;
}

const asset = (file: string): string => `${import.meta.env.BASE_URL}samples/${file}`;

export const SAMPLES: SampleDef[] = [
  { id: 'sample-01', url: asset('sample-01.svg') },
  { id: 'sample-02', url: asset('sample-02.svg') },
  { id: 'sample-03', url: asset('sample-03.svg') },
  { id: 'sample-04', url: asset('sample-04.svg') },
];
