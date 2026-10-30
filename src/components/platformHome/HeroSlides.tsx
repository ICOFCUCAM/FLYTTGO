import { useEffect, useState } from 'react';
import { HERO_SLIDES } from '../../lib/constants';

/* The hero picture is the old site's slideshow; the design's caption and card stay over it. */
export default function HeroSlides({ alt }: { alt: string }) {
  const [images] = useState(() => [...new Set(HERO_SLIDES.map(s => s.image))]);
  const [i, setI] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const t = window.setInterval(() => setI(n => (n + 1) % images.length), 5000);
    return () => window.clearInterval(t);
  }, [images.length]);
  return (
    <>
      <div className="fgp-slides">
        {images.map((src, n) => <img key={src} src={src} alt={n === 0 ? alt : ''} className={n === i ? 'on' : ''} loading={n === 0 ? 'eager' : 'lazy'} />)}
      </div>
      <div className="fgp-dots" role="group" aria-label="Slides">
        {images.map((src, n) => (
          <button key={src} type="button" aria-label={`${n + 1} / ${images.length}`} aria-pressed={n === i}
            className={n === i ? 'on' : ''} onClick={() => setI(n)} />
        ))}
      </div>
    </>
  );
}
