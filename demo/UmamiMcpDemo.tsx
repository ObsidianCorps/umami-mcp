import type { CSSProperties, ReactNode } from 'react';
import {
  AbsoluteFill,
  Easing,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

const palette = {
  background: '#070b16',
  panel: '#0d1424',
  panelRaised: '#121c30',
  border: '#26334c',
  text: '#f4f7fb',
  muted: '#91a0b8',
  red: '#e43f5a',
  blue: '#4e8cff',
  green: '#35c98a',
  amber: '#f3b950',
};

const fontFamily = 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif';

const clamp = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };

function fade(frame: number, from: number, to: number) {
  return interpolate(frame, [from, to], [0, 1], {
    ...clamp,
    easing: Easing.out((value) => Easing.quad(value)),
  });
}

const BrowserShell = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      width: 900,
      height: 480,
      border: `1px solid ${palette.border}`,
      borderRadius: 18,
      overflow: 'hidden',
      background: palette.panel,
      boxShadow: '0 28px 90px rgba(0, 0, 0, 0.45)',
    }}
  >
    <div
      style={{
        height: 48,
        padding: '0 18px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: `1px solid ${palette.border}`,
        background: '#0a1020',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {[palette.red, palette.amber, palette.green].map((color) => (
          <span
            key={color}
            style={{ width: 10, height: 10, borderRadius: 10, background: color }}
          />
        ))}
      </div>
      <div style={{ color: palette.muted, fontSize: 13, letterSpacing: 0.2 }}>
        AI client · ObsidianCorps Umami MCP
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          color: palette.green,
          fontSize: 12,
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: 7, background: palette.green }} />
        Read-only
      </div>
    </div>
    {children}
  </div>
);

const Sidebar = () => (
  <div
    style={{
      width: 190,
      padding: '24px 18px',
      borderRight: `1px solid ${palette.border}`,
      background: '#0a1120',
      boxSizing: 'border-box',
    }}
  >
    <div
      style={{ fontSize: 12, color: palette.muted, textTransform: 'uppercase', letterSpacing: 1.4 }}
    >
      Connected source
    </div>
    <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 9,
          display: 'grid',
          placeItems: 'center',
          color: '#fff',
          fontWeight: 800,
          background: `linear-gradient(135deg, ${palette.red}, ${palette.blue})`,
        }}
      >
        U
      </div>
      <div>
        <div style={{ color: palette.text, fontWeight: 650, fontSize: 14 }}>Umami</div>
        <div style={{ color: palette.green, fontSize: 11, marginTop: 2 }}>Connected</div>
      </div>
    </div>
    <div style={{ marginTop: 28, color: palette.muted, fontSize: 12, lineHeight: 2.2 }}>
      <div style={{ color: palette.text }}>Overview</div>
      <div>Conversions</div>
      <div>Web Vitals</div>
      <div>Sessions</div>
    </div>
    <div
      style={{
        position: 'absolute',
        bottom: 28,
        left: 18,
        color: palette.muted,
        fontSize: 10,
        lineHeight: 1.5,
      }}
    >
      Demo data
      <br />
      No analytics SaaS
    </div>
  </div>
);

const Prompt = ({ text, frame }: { text: string; frame: number }) => {
  const typed = text.slice(0, Math.floor(interpolate(frame, [0, 42], [0, text.length], clamp)));
  return (
    <div style={{ alignSelf: 'flex-end', width: 520 }}>
      <div style={{ color: palette.muted, fontSize: 10, marginBottom: 7, textAlign: 'right' }}>
        YOU
      </div>
      <div
        style={{
          padding: '13px 16px',
          minHeight: 22,
          borderRadius: '14px 14px 4px 14px',
          background: '#1b2a46',
          color: palette.text,
          fontSize: 15,
          lineHeight: 1.45,
        }}
      >
        {typed}
        {frame < 48 ? <span style={{ color: palette.blue }}>▍</span> : null}
      </div>
    </div>
  );
};

const AssistantCard = ({ frame, children }: { frame: number; children: ReactNode }) => {
  const { fps } = useVideoConfig();
  const entrance = spring({ frame: frame - 56, fps, config: { damping: 200 } });
  return (
    <div
      style={{
        opacity: entrance,
        transform: `translateY(${interpolate(entrance, [0, 1], [12, 0])}px)`,
        width: 580,
      }}
    >
      <div style={{ color: palette.muted, fontSize: 10, marginBottom: 7 }}>UMAMI MCP</div>
      <div
        style={{
          padding: 16,
          border: `1px solid ${palette.border}`,
          borderRadius: '4px 14px 14px 14px',
          background: palette.panelRaised,
          color: palette.text,
        }}
      >
        {children}
      </div>
    </div>
  );
};

const Metric = ({
  label,
  value,
  detail,
  color = palette.blue,
}: {
  label: string;
  value: string;
  detail: string;
  color?: string;
}) => (
  <div style={{ flex: 1 }}>
    <div
      style={{ color: palette.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8 }}
    >
      {label}
    </div>
    <div style={{ color: palette.text, fontWeight: 750, fontSize: 21, marginTop: 4 }}>{value}</div>
    <div style={{ color, fontSize: 11, marginTop: 3 }}>{detail}</div>
  </div>
);

const Bars = ({ frame }: { frame: number }) => {
  const values = [30, 42, 36, 54, 49, 65, 59, 76, 70, 84, 78, 92];
  return (
    <div style={{ height: 72, display: 'flex', alignItems: 'flex-end', gap: 8, marginTop: 14 }}>
      {values.map((value, index) => {
        const progress = fade(frame, 66 + index * 2, 88 + index * 2);
        return (
          <div
            key={index}
            style={{
              flex: 1,
              height: `${value * progress}%`,
              borderRadius: '4px 4px 1px 1px',
              background: index > 7 ? palette.blue : '#314466',
            }}
          />
        );
      })}
    </div>
  );
};

const TrafficAnswer = ({ frame }: { frame: number }) => (
  <AssistantCard frame={frame}>
    <div style={{ display: 'flex', gap: 24 }}>
      <Metric label="Visitors" value="18,420" detail="↑ 24% vs last month" color={palette.green} />
      <Metric label="Pageviews" value="31,806" detail="↑ 18% vs last month" color={palette.green} />
      <Metric label="Bounce rate" value="41%" detail="↓ 6 points" color={palette.green} />
    </div>
    <Bars frame={frame} />
  </AssistantCard>
);

const SourcesAnswer = ({ frame }: { frame: number }) => {
  const rows = [
    ['Organic search', '42%', palette.blue],
    ['Direct', '28%', palette.red],
    ['LinkedIn', '18%', palette.green],
  ] as const;
  return (
    <AssistantCard frame={frame}>
      <div style={{ color: palette.text, fontSize: 14, fontWeight: 650 }}>
        Top conversion sources · 126 leads
      </div>
      <div style={{ marginTop: 13, display: 'grid', gap: 10 }}>
        {rows.map(([label, value, color], index) => {
          const progress = fade(frame, 64 + index * 7, 92 + index * 7);
          return (
            <div
              key={label}
              style={{
                display: 'grid',
                gridTemplateColumns: '120px 1fr 40px',
                gap: 12,
                alignItems: 'center',
                fontSize: 12,
              }}
            >
              <span style={{ color: palette.muted }}>{label}</span>
              <div
                style={{ height: 8, borderRadius: 8, background: '#1a263b', overflow: 'hidden' }}
              >
                <div
                  style={{
                    width: `${Number.parseInt(value) * 2.15 * progress}%`,
                    height: '100%',
                    borderRadius: 8,
                    background: color,
                  }}
                />
              </div>
              <span style={{ color: palette.text, fontWeight: 700 }}>{value}</span>
            </div>
          );
        })}
      </div>
    </AssistantCard>
  );
};

const VitalsAnswer = ({ frame }: { frame: number }) => {
  const rows = [
    ['/pricing', 'LCP', '3.8s', 'Poor'],
    ['/docs/getting-started', 'INP', '310ms', 'Poor'],
    ['/blog/analytics-guide', 'CLS', '0.19', 'Needs work'],
  ] as const;
  return (
    <AssistantCard frame={frame}>
      <div style={{ color: palette.text, fontSize: 14, fontWeight: 650 }}>
        3 pages need attention
      </div>
      <div style={{ marginTop: 10 }}>
        {rows.map(([path, metric, value, status], index) => (
          <div
            key={path}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 48px 58px 82px',
              alignItems: 'center',
              padding: '9px 0',
              borderTop: `1px solid ${palette.border}`,
              opacity: fade(frame, 64 + index * 7, 86 + index * 7),
              fontSize: 11,
            }}
          >
            <span style={{ color: palette.text }}>{path}</span>
            <span style={{ color: palette.muted }}>{metric}</span>
            <span style={{ color: palette.text, fontWeight: 700 }}>{value}</span>
            <span style={{ color: status === 'Poor' ? palette.red : palette.amber }}>{status}</span>
          </div>
        ))}
      </div>
    </AssistantCard>
  );
};

type SceneProps = {
  prompt: string;
  answer: (props: { frame: number }) => ReactNode;
};

const QueryScene = ({ prompt, answer }: SceneProps) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 10, 188, 210], [0, 1, 1, 0], clamp);
  return (
    <div style={{ display: 'flex', height: 432, opacity }}>
      <div style={{ position: 'relative' }}>
        <Sidebar />
      </div>
      <div
        style={{
          flex: 1,
          padding: '28px 32px',
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
          boxSizing: 'border-box',
        }}
      >
        <Prompt text={prompt} frame={frame} />
        {answer({ frame })}
      </div>
    </div>
  );
};

const Intro = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const entrance = spring({ frame, fps, config: { damping: 200 } });
  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        opacity: interpolate(frame, [0, 12, 48, 60], [0, 1, 1, 0], clamp),
      }}
    >
      <div
        style={{
          transform: `scale(${interpolate(entrance, [0, 1], [0.96, 1])})`,
          textAlign: 'center',
        }}
      >
        <div
          style={{
            color: palette.muted,
            fontSize: 15,
            letterSpacing: 2.2,
            textTransform: 'uppercase',
          }}
        >
          ObsidianCorps · Open source
        </div>
        <div style={{ color: palette.text, fontWeight: 800, fontSize: 42, marginTop: 12 }}>
          Ask Umami. Get answers.
        </div>
        <div style={{ color: palette.muted, fontSize: 17, marginTop: 12 }}>
          Cloud or self-hosted · Read-only by default
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Outro = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{ justifyContent: 'center', alignItems: 'center', opacity: fade(frame, 0, 12) }}
    >
      <div style={{ textAlign: 'center' }}>
        <div style={{ color: palette.text, fontSize: 29, fontWeight: 800 }}>
          Your analytics. Your infrastructure.
        </div>
        <div style={{ color: palette.muted, fontSize: 15, marginTop: 13 }}>
          github.com/ObsidianCorps/umami-mcp
        </div>
        <div
          style={{
            color: palette.blue,
            fontFamily: 'ui-monospace, SFMono-Regular, monospace',
            fontSize: 14,
            marginTop: 22,
          }}
        >
          npx -y @obsidiancorps/umami-mcp
        </div>
      </div>
    </AbsoluteFill>
  );
};

const backgroundStyle: CSSProperties = {
  background: `radial-gradient(circle at 20% 0%, rgba(78, 140, 255, 0.16), transparent 34%), radial-gradient(circle at 90% 90%, rgba(228, 63, 90, 0.14), transparent 38%), ${palette.background}`,
  fontFamily,
  justifyContent: 'center',
  alignItems: 'center',
};

export const UmamiMcpDemo = () => (
  <AbsoluteFill style={backgroundStyle}>
    <Sequence from={0} durationInFrames={60} premountFor={30}>
      <Intro />
    </Sequence>
    <Sequence from={60} durationInFrames={210} premountFor={30}>
      <BrowserShell>
        <QueryScene
          prompt="Compare website traffic with last month."
          answer={({ frame }) => <TrafficAnswer frame={frame} />}
        />
      </BrowserShell>
    </Sequence>
    <Sequence from={270} durationInFrames={210} premountFor={30}>
      <BrowserShell>
        <QueryScene
          prompt="Which sources generated the most conversions?"
          answer={({ frame }) => <SourcesAnswer frame={frame} />}
        />
      </BrowserShell>
    </Sequence>
    <Sequence from={480} durationInFrames={210} premountFor={30}>
      <BrowserShell>
        <QueryScene
          prompt="Find pages with poor Web Vitals."
          answer={({ frame }) => <VitalsAnswer frame={frame} />}
        />
      </BrowserShell>
    </Sequence>
    <Sequence from={690} durationInFrames={60} premountFor={30}>
      <Outro />
    </Sequence>
  </AbsoluteFill>
);
