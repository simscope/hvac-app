import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';

function ErrorBoundary({ children }) {
  const [err, setErr] = React.useState(null);
  return err
    ? <pre style={{whiteSpace:'pre-wrap',padding:16,color:'crimson'}}>Error: {String(err)}</pre>
    : <React.ErrorBoundary fallbackRender={({error}) => <pre style={{whiteSpace:'pre-wrap',padding:16,color:'crimson'}}>{String(error)}</pre>}>{children}</React.ErrorBoundary>;
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <HashRouter>
    <App />
  </HashRouter>
);
