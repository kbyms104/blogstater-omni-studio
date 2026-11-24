import React, { useEffect, useRef } from 'react';
import { ThumbnailConfig } from '../types';
import { Download, CheckCircle2, Palette, Eye } from 'lucide-react';

interface ThumbnailCanvasProps {
  config: ThumbnailConfig;
  onChange: (updated: ThumbnailConfig) => void;
  onApplyToCurrentPost?: (dataUrl: string) => void;
}

const COLOR_PRESETS = [
  { name: '네이버 에메랄드', from: '#047857', to: '#064e3b', accent: '#34d399' },
  { name: '티스토리 오렌지', from: '#ea580c', to: '#7c2d12', accent: '#fbbf24' },
  { name: '인디고 테크', from: '#3730a3', to: '#1e1b4b', accent: '#818cf8' },
  { name: '로얄 골드 & 블랙', from: '#18181b', to: '#09090b', accent: '#facc15' },
  { name: '사이버 핑크 & 퍼플', from: '#86198f', to: '#3b0764', accent: '#f472b6' },
  { name: '오션 블루', from: '#0369a1', to: '#0c4a6e', accent: '#38bdf8' },
];

export const ThumbnailCanvas: React.FC<ThumbnailCanvasProps> = ({
  config,
  onChange,
  onApplyToCurrentPost,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = config.aspectRatio === '1:1' ? 800 : config.aspectRatio === '16:9' ? 960 : 800;
    const height = config.aspectRatio === '1:1' ? 800 : config.aspectRatio === '16:9' ? 540 : 600;
    canvas.width = width;
    canvas.height = height;

    // 1. Background Gradient
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, config.bgGradientFrom || '#3730a3');
    grad.addColorStop(1, config.bgGradientTo || '#0f172a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // 2. Decorative Grid & Glow
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += 48) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Radial Glow Circle
    const radial = ctx.createRadialGradient(
      width * 0.8,
      height * 0.2,
      20,
      width * 0.8,
      height * 0.2,
      width * 0.55
    );
    radial.addColorStop(0, `${config.accentColor}44`);
    radial.addColorStop(1, 'transparent');
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();

    // 3. Inner Card Border or Glass Frame depending on template
    if (config.template === 'viral_card' || config.template === 'gradient_glass') {
      ctx.save();
      ctx.fillStyle = 'rgba(15, 23, 42, 0.36)';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.lineWidth = 2;
      const pad = 44;
      ctx.beginPath();
      ctx.roundRect(pad, pad, width - pad * 2, height - pad * 2, 28);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    } else if (config.template === 'magazine_bold') {
      ctx.save();
      ctx.fillStyle = config.accentColor;
      ctx.fillRect(0, 0, 18, height);
      ctx.restore();
    }

    const contentX = 84;
    let currentY = config.aspectRatio === '16:9' ? 115 : 165;

    // 4. Top Category Badge
    if (config.badgeText) {
      ctx.save();
      ctx.font = '800 22px Pretendard, sans-serif';
      const badgeMetrics = ctx.measureText(config.badgeText);
      const badgeW = badgeMetrics.width + 44;
      const badgeH = 48;

      ctx.fillStyle = config.accentColor || '#34d399';
      ctx.beginPath();
      ctx.roundRect(contentX, currentY - 34, badgeW, badgeH, 999);
      ctx.fill();

      ctx.fillStyle = '#09090b';
      ctx.fillText(config.badgeText, contentX + 22, currentY - 2);
      ctx.restore();
      currentY += 74;
    }

    // 5. Main Headline (Auto word/character wrapping)
    ctx.save();
    ctx.fillStyle = config.textColor || '#ffffff';
    const fontSize = config.aspectRatio === '16:9' ? 54 : 62;
    ctx.font = `900 ${fontSize}px Pretendard, "Malgun Gothic", sans-serif`;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 4;

    const maxTextWidth = width - contentX * 2;
    const words = (config.headline || '클릭을 부르는 핵심 주제').split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      if (ctx.measureText(testLine).width > maxTextWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);

    for (const line of lines.slice(0, 3)) {
      ctx.fillText(line, contentX, currentY);
      currentY += fontSize * 1.26;
    }
    ctx.restore();

    // 6. Subheadline
    if (config.subHeadline) {
      currentY += 12;
      ctx.save();
      ctx.fillStyle = 'rgba(241, 245, 249, 0.9)';
      ctx.font = '600 28px Pretendard, "Malgun Gothic", sans-serif';
      ctx.fillText(config.subHeadline.slice(0, 34), contentX, currentY);
      ctx.restore();
    }

    // 7. Bottom Accent Bar & Footer Tag
    ctx.save();
    ctx.fillStyle = config.accentColor;
    ctx.fillRect(contentX, height - 105, 90, 6);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
    ctx.font = '700 22px Pretendard, sans-serif';
    ctx.fillText(config.footerTag || '@BlogStater Studio', contentX, height - 68);
    ctx.restore();
  }, [config]);

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `thumbnail-${Date.now()}.png`;
    a.click();
  };

  const handleApply = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    onChange({ ...config, dataUrl: url });
    if (onApplyToCurrentPost) {
      onApplyToCurrentPost(url);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left Config Form */}
      <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2 tracking-tight">
            <Palette className="w-5 h-5 text-slate-700" />
            고클릭률(CTR) 썸네일 디자인 설정
          </h3>
          <span className="text-xs px-2.5 py-1 rounded-md bg-slate-100 border border-slate-200 text-slate-600 font-medium">
            Canvas 실시간 렌더링
          </span>
        </div>

        {/* Aspect Ratio & Template */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">비율 (플랫폼 최적)</label>
            <select
              value={config.aspectRatio}
              onChange={(e) =>
                onChange({ ...config, aspectRatio: e.target.value as ThumbnailConfig['aspectRatio'] })
              }
              className="w-full bg-white border border-slate-300 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 rounded-lg px-3 py-2 text-sm text-slate-900 outline-none"
            >
              <option value="1:1">1:1 정방형 (네이버 대표 이미지)</option>
              <option value="16:9">16:9 와이드 (티스토리/워드프레스/벨로그)</option>
              <option value="4:3">4:3 스탠다드 카드</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">레이아웃 템플릿</label>
            <select
              value={config.template}
              onChange={(e) =>
                onChange({ ...config, template: e.target.value as ThumbnailConfig['template'] })
              }
              className="w-full bg-white border border-slate-300 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 rounded-lg px-3 py-2 text-sm text-slate-900 outline-none"
            >
              <option value="viral_card">바이럴 글래스 카드형</option>
              <option value="magazine_bold">매거진 좌측 포인트형</option>
              <option value="minimal_tech">미니멀 테크 그리드형</option>
              <option value="gradient_glass">그라데이션 프레임형</option>
            </select>
          </div>
        </div>

        {/* Color Presets */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1.5">원클릭 컬러 테마 프리셋</label>
          <div className="grid grid-cols-3 gap-2">
            {COLOR_PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() =>
                  onChange({
                    ...config,
                    bgGradientFrom: p.from,
                    bgGradientTo: p.to,
                    accentColor: p.accent,
                  })
                }
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:border-slate-400 bg-slate-50 hover:bg-white text-xs text-slate-700 font-medium transition"
              >
                <span
                  className="w-3.5 h-3.5 rounded-full shrink-0 border border-black/10"
                  style={{ background: `linear-gradient(135deg, ${p.from}, ${p.accent})` }}
                />
                <span className="truncate">{p.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Texts */}
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">상단 강조 배지 문구</label>
            <input
              type="text"
              value={config.badgeText}
              onChange={(e) => onChange({ ...config, badgeText: e.target.value })}
              placeholder="예: 2026 최신 핵심 총정리"
              className="w-full bg-white border border-slate-300 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">메인 헤드라인 (핵심 키워드)</label>
            <input
              type="text"
              value={config.headline}
              onChange={(e) => onChange({ ...config, headline: e.target.value })}
              placeholder="예: 청년도약계좌 만기 수령액 계산법"
              className="w-full bg-white border border-slate-300 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 rounded-lg px-3 py-2 text-sm text-slate-900 font-semibold placeholder:text-slate-400 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">서브 카피 (클릭 유도 문구)</label>
            <input
              type="text"
              value={config.subHeadline}
              onChange={(e) => onChange({ ...config, subHeadline: e.target.value })}
              placeholder="예: 모르면 손해 보는 핵심 조건 & 3단계 완벽 비교"
              className="w-full bg-white border border-slate-300 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">하단 블로그 워터마크/서명</label>
            <input
              type="text"
              value={config.footerTag}
              onChange={(e) => onChange({ ...config, footerTag: e.target.value })}
              className="w-full bg-white border border-slate-300 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 outline-none"
            />
          </div>
        </div>

        <div className="pt-2 flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={handleApply}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm shadow-sm transition"
          >
            <CheckCircle2 className="w-4 h-4" />
            현재 포스팅 대표 썸네일로 삽입
          </button>
          <button
            type="button"
            onClick={handleDownload}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white hover:bg-slate-50 text-slate-700 font-medium text-sm border border-slate-200 shadow-sm transition"
          >
            <Download className="w-4 h-4" />
            PNG 저장
          </button>
        </div>
      </div>

      {/* Right Live Canvas Preview */}
      <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 shadow-sm flex flex-col items-center justify-center">
        <div className="mb-3 flex items-center gap-2 text-xs text-slate-500 font-medium">
          <Eye className="w-4 h-4 text-slate-500" />
          실시간 고해상도 썸네일 미리보기 (발행 시 본문 최상단 및 로컬 패키지에 자동 포함됩니다)
        </div>
        <div className="w-full max-w-[540px] flex items-center justify-center bg-slate-100 p-5 rounded-xl border border-slate-200">
          <canvas
            ref={canvasRef}
            className="w-full h-auto rounded-lg shadow-sm"
          />
        </div>
      </div>
    </div>
  );
};
