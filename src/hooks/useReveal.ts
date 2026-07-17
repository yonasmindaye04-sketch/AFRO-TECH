import { useEffect } from 'react';

export function useReveal(selector = '[data-reveal]') {
  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const obs = new IntersectionObserver(
      entries => {
        entries.forEach(e => {
          if (e.isIntersecting) {
            const delay = (e.target as HTMLElement).dataset.delay;
            if (delay) {
              setTimeout(() => e.target.classList.add('is-visible'), +delay);
            } else {
              e.target.classList.add('is-visible');
            }
            obs.unobserve(e.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -20px 0px' },
    );

    document.querySelectorAll<HTMLElement>(selector).forEach(el => {
      if (prefersReduced) {
        el.classList.add('is-visible');
        return;
      }
      obs.observe(el);
    });

    return () => obs.disconnect();
  }, [selector]);
}
