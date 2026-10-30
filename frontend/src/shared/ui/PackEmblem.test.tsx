import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PackEmblem, type PackEmblemPack } from './PackEmblem';

function pack(over: Partial<PackEmblemPack> = {}): PackEmblemPack {
  return {
    slug: 'sample-pack',
    partner_name: 'Sample Pack',
    type: 'country',
    default_locale: 'en-US',
    metadata: { country: 'US' },
    branding: { primary_color: '#123456', accent_color: null },
    ...over,
  };
}

describe('PackEmblem', () => {
  it('draws the flag for a country pack and no logo beside it', () => {
    const { container } = render(<PackEmblem pack={pack()} size={48} />);

    const plate = container.querySelector('[data-pack-emblem]');
    expect(plate?.getAttribute('data-pack-emblem')).toBe('flag');
    expect(plate?.getAttribute('data-country')).toBe('us');
    // The point of the change: the pack's own mark is gone, not merely moved.
    expect(container.querySelector('img[alt$="logo"]')).toBeNull();
  });

  it('flies no flag for a pack that serves no single country', () => {
    // Cross-region packs declare XX. It is a real value meaning "no single
    // market", so it must not resolve to a flag of anything.
    const { container } = render(
      <PackEmblem
        pack={pack({ type: 'industry', slug: 'renewables-epc', metadata: { country: 'XX' } })}
        size={48}
      />,
    );
    expect(container.querySelector('[data-pack-emblem]')?.getAttribute('data-pack-emblem')).toBe(
      'monogram',
    );
  });

  it('flies no flag for an industry pack that carries a country anyway', () => {
    // The gate is the pack's type, not the presence of a country key. An
    // industry pack with a country would otherwise fly a flag for a market it
    // does not claim.
    const { container } = render(
      <PackEmblem pack={pack({ type: 'industry', metadata: { country: 'DE' } })} size={48} />,
    );
    expect(container.querySelector('[data-pack-emblem]')?.getAttribute('data-pack-emblem')).toBe(
      'monogram',
    );
  });

  it('draws a monogram, never a logo, for a pack with no country', () => {
    const { container } = render(<PackEmblem pack={pack({ type: 'partner' })} size={48} />);
    const plate = container.querySelector('[data-pack-emblem]');
    expect(plate?.getAttribute('data-pack-emblem')).toBe('monogram');
    expect(plate?.textContent).toBe('SP');
    expect(container.querySelector('img')).toBeNull();
  });

  it('tells the two packs apart that share one flag', () => {
    // us-california and us-texas both fly the same national flag, so the flag
    // alone cannot distinguish them and an assertion that each "renders a
    // flag" would pass on a build where they are indistinguishable. The
    // subdivision code is what carries the difference, so the test compares
    // the two renderings against each other rather than checking each alone.
    const california = render(
      <PackEmblem
        pack={pack({
          slug: 'us-california',
          metadata: { country: 'US', subdivision: 'US-CA' },
        })}
        size={48}
      />,
    );
    const texas = render(
      <PackEmblem
        pack={pack({ slug: 'us-texas', metadata: { country: 'US', subdivision: 'US-TX' } })}
        size={48}
      />,
    );

    const a = california.container.querySelector('[data-pack-emblem]')?.textContent ?? '';
    const b = texas.container.querySelector('[data-pack-emblem]')?.textContent ?? '';
    expect(a).toBe('CA');
    expect(b).toBe('TX');
    expect(a).not.toBe(b);
  });

  it('leaves the subdivision code off a plate too small to hold it', () => {
    const { container } = render(
      <PackEmblem
        pack={pack({ metadata: { country: 'US', subdivision: 'US-CA' } })}
        size={20}
      />,
    );
    expect(container.querySelector('[data-pack-emblem]')?.textContent).toBe('');
  });
});
