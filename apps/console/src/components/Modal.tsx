import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';

export function Modal({
  title,
  subtitle,
  children,
  onClose,
  size = 'default',
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  size?: 'default' | 'medium' | 'wide';
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.body.classList.add('modalOpen');
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.classList.remove('modalOpen');
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <div className={`modal ${size}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modalHeader">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button className="iconButton" type="button" aria-label="Close" title="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
