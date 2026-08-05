"use client";

import { useEffect, useRef } from "react";

export default function Embers() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = window.innerWidth;
    let height = window.innerHeight;
    
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const particles: Particle[] = [];
    const PARTICLE_COUNT = 150;

    class Particle {
      x: number;
      y: number;
      size: number;
      speedX: number;
      speedY: number;
      life: number;
      maxLife: number;
      wobbleSpeed: number;
      wobbleOffset: number;

      constructor() {
        this.x = Math.random() * width;
        this.y = height + Math.random() * 200;
        this.size = Math.random() * 2.5 + 0.5;
        this.speedX = (Math.random() - 0.5) * 0.5;
        this.speedY = -(Math.random() * 1.5 + 0.5);
        this.life = 0;
        this.maxLife = Math.random() * 200 + 100;
        this.wobbleSpeed = Math.random() * 0.05 + 0.01;
        this.wobbleOffset = Math.random() * Math.PI * 2;
      }

      update(mx: number, my: number) {
        // Organic drift
        this.x += this.speedX + Math.sin(this.life * this.wobbleSpeed + this.wobbleOffset) * 0.5;
        this.y += this.speedY;
        this.life++;

        // Mouse interaction (repel)
        const dx = mx - this.x;
        const dy = my - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 120) {
          const force = (120 - dist) / 120;
          this.x -= (dx / dist) * force * 8;
          this.y -= (dy / dist) * force * 8;
        }

        if (this.life >= this.maxLife || this.y < -50) {
          this.x = Math.random() * width;
          this.y = height + 50;
          this.life = 0;
        }
      }

      draw() {
        if (!ctx) return;
        // Fade in and fade out
        let alpha = 1;
        if (this.life < 20) {
          alpha = this.life / 20;
        } else if (this.life > this.maxLife - 40) {
          alpha = Math.max(0, (this.maxLife - this.life) / 40);
        }
        
        ctx.fillStyle = `rgba(251, 146, 60, ${alpha * 0.8})`; // amber-400
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
        
        // Inner core for larger particles
        if (this.size > 1.5) {
          ctx.fillStyle = `rgba(255, 237, 213, ${alpha})`; // orange-50
          ctx.beginPath();
          ctx.arc(this.x, this.y, this.size * 0.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push(new Particle());
    }

    let mouseX = -1000;
    let mouseY = -1000;

    const handlePointerMove = (e: PointerEvent) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    };

    window.addEventListener("pointermove", handlePointerMove);

    const handleResize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    };
    window.addEventListener("resize", handleResize);

    let animationFrameId = 0;
    let running = false;

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      ctx.globalCompositeOperation = "screen";

      particles.forEach((p) => {
        p.update(mouseX, mouseY);
        p.draw();
      });
      animationFrameId = requestAnimationFrame(render);
    };

    // Decorative animation only: skip the render loop entirely when the user
    // has asked for reduced motion, which also frees up the main thread.
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    const start = () => {
      if (running || motionQuery.matches) return;
      running = true;
      animationFrameId = requestAnimationFrame(render);
    };

    const stop = () => {
      running = false;
      cancelAnimationFrame(animationFrameId);
    };

    const handleMotionChange = () => {
      if (motionQuery.matches) {
        stop();
        ctx.clearRect(0, 0, width, height);
      } else {
        start();
      }
    };
    motionQuery.addEventListener("change", handleMotionChange);

    start();

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("resize", handleResize);
      motionQuery.removeEventListener("change", handleMotionChange);
      stop();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="absolute inset-0 pointer-events-none z-0"
    />
  );
}
