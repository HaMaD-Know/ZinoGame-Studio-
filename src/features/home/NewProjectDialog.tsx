import { Box, Mountain, Sparkles, Shapes } from 'lucide-react';
import { useId, useState } from 'react';
import { Dialog } from '../../components/feedback';
import { Button, Field } from '../../components/ui';
import { PROJECT_TEMPLATES } from '../../engine/project/templates';
import type { ProjectTemplateId } from '../../engine/project/types';
import { projectNameError } from '../../engine/project/validation';

type TemplateId = Exclude<ProjectTemplateId, 'example'>;

const ART: Record<TemplateId, { icon: typeof Box; background: string }> = {
  'empty-baseplate': { icon: Mountain, background: 'linear-gradient(135deg, #4a8fe7, #6ec1ff)' },
  'empty-3d': { icon: Box, background: 'linear-gradient(135deg, #3a3f5c, #6b7394)' },
  playground: { icon: Shapes, background: 'linear-gradient(135deg, #ff8a1f, #ff5d8f)' },
};

export function NewProjectDialog({
  existingNames,
  onCancel,
  onCreate,
}: {
  existingNames: string[];
  onCancel: () => void;
  onCreate: (input: { name: string; description: string; template: TemplateId }) => Promise<void>;
}) {
  const defaultName = (() => {
    let n = 1;
    while (existingNames.includes(n === 1 ? 'My Game' : `My Game ${n}`)) n++;
    return n === 1 ? 'My Game' : `My Game ${n}`;
  })();
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState('');
  const [template, setTemplate] = useState<TemplateId>('empty-baseplate');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const nameId = useId();
  const descId = useId();
  const error = projectNameError(name);

  const submit = async () => {
    setTouched(true);
    if (error) return;
    setBusy(true);
    setFailure(null);
    try {
      await onCreate({ name: name.trim(), description: description.trim(), template });
    } catch (err) {
      setFailure((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Create a new project"
      icon={Sparkles}
      wide
      onClose={onCancel}
      actions={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Creating…' : 'Create project'}
          </Button>
        </>
      }
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Project name" htmlFor={nameId} error={touched ? error : null} hint="You can change this later.">
          <input
            id={nameId}
            className="input"
            value={name}
            maxLength={80}
            aria-invalid={touched && !!error}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setTouched(true)}
            data-autofocus
          />
        </Field>
        <Field label="Description (optional)" htmlFor={descId}>
          <textarea
            id={descId}
            className="textarea"
            value={description}
            maxLength={500}
            rows={2}
            placeholder="What is your game about?"
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <div className="field">
          <span className="field-label" id={`${nameId}-tpl`}>
            Start from
          </span>
          <div className="template-grid" role="radiogroup" aria-labelledby={`${nameId}-tpl`}>
            {PROJECT_TEMPLATES.map((t) => {
              const art = ART[t.id];
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={template === t.id}
                  className="template-option"
                  onClick={() => setTemplate(t.id)}
                >
                  <div className="template-art" style={{ background: art.background }}>
                    <art.icon size={28} aria-hidden="true" />
                  </div>
                  <strong>
                    {t.name} {t.recommended && <span className="chip chip-accent">Recommended</span>}
                  </strong>
                  <span className="small muted">{t.description}</span>
                </button>
              );
            })}
          </div>
        </div>
        {failure && (
          <div className="banner banner-danger" role="alert">
            Could not create the project: {failure}
          </div>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
