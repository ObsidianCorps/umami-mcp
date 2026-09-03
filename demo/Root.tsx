import { Composition } from 'remotion';

import { UmamiMcpDemo } from './UmamiMcpDemo';

export const RemotionRoot = () => (
  <Composition
    id="UmamiMcpDemo"
    component={UmamiMcpDemo}
    durationInFrames={750}
    fps={30}
    width={960}
    height={540}
  />
);
