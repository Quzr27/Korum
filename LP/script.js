/*
 * Quiet starfield
 * -----------------------------------------------------------
 * Canvas 2D, ~90 particles, very slow drift with per-particle
 * pulse. Ivory-dominant palette with a minority of warm gold
 * accents. Wraps around viewport edges. Pauses when the tab is
 * hidden. Skipped entirely under prefers-reduced-motion.
 */

const canvas = document.getElementById("stars");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (canvas && !reducedMotion) initStars(canvas);

function initStars(canvas) {
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const COUNT = 96;
  const particles = [];
  let width = 0;
  let height = 0;
  let raf = 0;
  let lastT = 0;

  const rand = (a, b) => a + Math.random() * (b - a);

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * DPR);
    canvas.height = Math.floor(height * DPR);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  function makeParticle() {
    // Mostly ivory foreground dots, a minority of cool-blue accent dots.
    const blue = Math.random() < 0.18;
    const big = Math.random() < 0.12;
    return {
      x: rand(0, width),
      y: rand(0, height),
      vx: rand(-0.06, 0.06),
      vy: rand(-0.05, 0.05),
      r: big ? rand(1.1, 1.6) : rand(0.35, 0.9),
      base: big ? rand(0.28, 0.48) : rand(0.1, 0.28),
      phase: Math.random() * Math.PI * 2,
      speed: rand(0.0004, 0.0011),
      blue,
      big,
    };
  }

  function seed() {
    particles.length = 0;
    for (let i = 0; i < COUNT; i++) particles.push(makeParticle());
  }

  function draw(t) {
    const dt = Math.min(48, t - lastT || 16);
    lastT = t;

    ctx.clearRect(0, 0, width, height);

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.x += p.vx * dt * 0.06;
      p.y += p.vy * dt * 0.06;

      if (p.x < -4) p.x = width + 4;
      else if (p.x > width + 4) p.x = -4;
      if (p.y < -4) p.y = height + 4;
      else if (p.y > height + 4) p.y = -4;

      const pulse = 0.7 + Math.sin(t * p.speed + p.phase) * 0.3;
      const a = p.base * pulse;

      if (p.blue) {
        // --accent #5e92ff
        ctx.fillStyle = `rgba(94, 146, 255, ${a})`;
        if (p.big) {
          ctx.shadowColor = "rgba(94, 146, 255, 0.55)";
          ctx.shadowBlur = 8;
        } else {
          ctx.shadowBlur = 0;
        }
      } else {
        // --fg #efeee8
        ctx.fillStyle = `rgba(239, 238, 232, ${a * 0.85})`;
        ctx.shadowBlur = 0;
      }

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.shadowBlur = 0;

    raf = requestAnimationFrame(draw);
  }

  const onResize = () => {
    resize();
    // Re-seed so we don't get empty bands on aggressive resize.
    for (const p of particles) {
      if (p.x > width) p.x = rand(0, width);
      if (p.y > height) p.y = rand(0, height);
    }
  };

  resize();
  seed();
  window.addEventListener("resize", onResize, { passive: true });

  requestAnimationFrame((t) => {
    lastT = t;
    draw(t);
    canvas.classList.add("ready");
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
    } else {
      lastT = performance.now();
      raf = requestAnimationFrame(draw);
    }
  });
}
