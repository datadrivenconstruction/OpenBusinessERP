import { type ReactNode } from 'react';
import clsx from 'clsx';

/**
 * Page width + vertical rhythm for every module page. Horizontal gutters and
 * top padding come from AppLayout's <main> (px-4 sm:px-7 pt-6) - never add
 * padding here, or pages get double gutters.
 */
export const PAGE_CONTAINER_CLS = 'mx-auto w-full max-w-[1600px] space-y-5 animate-fade-in';

/** Width cap for forms / wizards INSIDE a page (keep the page itself full width). */
export const PAGE_FORM_CLS = 'w-full max-w-4xl';

export interface PageContainerProps {
  /** Visible page title (h1). Omit when the top bar title is enough. */
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned actions, primary first. */
  actions?: ReactNode;
  /** Tab strip rendered under the header row. */
  tabs?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export function PageContainer({ title, subtitle, actions, tabs, className, children }: PageContainerProps) {
  const hasHeader = title || subtitle || actions;
  return (
    <div className={clsx(PAGE_CONTAINER_CLS, className)}>
      {hasHeader && (
        <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1 basis-64">
            {title && <h1 className="text-xl font-semibold text-content-primary">{title}</h1>}
            {subtitle && <p className="mt-0.5 text-sm leading-relaxed text-content-tertiary">{subtitle}</p>}
          </div>
          {actions && <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {tabs}
      {children}
    </div>
  );
}
