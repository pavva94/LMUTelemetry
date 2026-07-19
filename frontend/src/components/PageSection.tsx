import type { ReactNode } from "react";

type Props = {
  number: string;
  title: string;
  description: string;
  children: ReactNode;
};

export function PageSection({ number, title, description, children }: Props) {
  const id = `page-section-${number}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  return (
    <section className="report-section span-12" aria-labelledby={id}>
      <header className="report-section-heading">
        <span>{number}</span>
        <div>
          <h2 id={id}>{title}</h2>
          <p>{description}</p>
        </div>
      </header>
      <div className="report-section-grid">{children}</div>
    </section>
  );
}
