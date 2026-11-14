import './mock';
import { createRoot } from 'react-dom/client';
import { initStore } from '../store';
import { Toasts } from '../components/ui';
import { Log } from '../log/Log';
import { params, pr } from './mock';
initStore();
createRoot(document.getElementById('root')!).render(<><div style={{ height: '100%' }}><Log projectId={params.get('project') ? pr[Number(params.get('project'))]! : null} /></div><Toasts /></>);
