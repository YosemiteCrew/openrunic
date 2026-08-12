export interface PillarCardProps {
  title: string;
  description: string;
}

export function PillarCard({ title, description }: PillarCardProps) {
  return (
    <article className="pillar-card">
      <h2>{title}</h2>
      <p>{description}</p>
    </article>
  );
}
