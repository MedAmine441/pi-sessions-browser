"use client";

import { useEffect, useRef } from "react";

interface ActivityRingProps {
  value: number; // e.g. messageCount
  max: number;   // max message count across all sessions
  size?: number;
}

export default function ActivityRing({ value, max, size = 36 }: ActivityRingProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    // Support high-DPI displays
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;

    const center = size / 2;
    const radius = (size / 2) - 3;
    
    // Calculate target percentage (clamped 0.01-1)
    const targetPercent = Math.min(Math.max(value / (max || 1), 0.05), 1);
    
    let currentPercent = 0;
    let animationFrameId: number;

    const render = () => {
      // Ease towards target
      currentPercent += (targetPercent - currentPercent) * 0.1;
      
      ctx.clearRect(0, 0, size, size);
      
      // Draw background track
      ctx.beginPath();
      ctx.arc(center, center, radius, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
      ctx.lineWidth = 3;
      ctx.stroke();

      // Draw active ring
      const startAngle = -Math.PI / 2;
      const endAngle = startAngle + (currentPercent * Math.PI * 2);
      
      ctx.beginPath();
      ctx.arc(center, center, radius, startAngle, endAngle);
      
      // Amber glow effect
      ctx.strokeStyle = "rgba(251, 146, 60, 0.9)"; // amber-400
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      
      ctx.shadowBlur = 6;
      ctx.shadowColor = "rgba(251, 146, 60, 0.8)";
      
      ctx.stroke();
      
      // Reset shadow for text
      ctx.shadowBlur = 0;
      
      // Draw text in center
      ctx.fillStyle = "rgba(251, 146, 60, 1)";
      ctx.font = `bold ${size/3}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(value.toString(), center, center + 1);

      if (Math.abs(targetPercent - currentPercent) > 0.001) {
        animationFrameId = requestAnimationFrame(render);
      }
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [value, max, size]);

  return <canvas ref={canvasRef} className="shrink-0 rounded-full bg-black/20 shadow-inner" title={`${value} messages`} />;
}
