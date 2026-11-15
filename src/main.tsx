import { createRoot } from 'react-dom/client';
import App from './App';
import { version } from '../package.json';
import './styles.css';
import './tools.css';
import './responsive.css';
import './agent.css';
import './extensions.css';
import './improvements.css';
import './studio.css';
import './ide.css';
import './settings.css';
import './agent-console.css';
import './appearance.css';
import './motion.css';
import './workspaces.css';

window.signaldeskBoot?.stage('interface', version);
createRoot(document.getElementById('root')!).render(<App />);
