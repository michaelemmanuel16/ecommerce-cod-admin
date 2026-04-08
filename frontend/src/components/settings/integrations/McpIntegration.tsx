import React, { useState, useEffect, useCallback } from 'react';
import { Bot, Copy, Check, Trash2, Plus, Key, AlertTriangle, RefreshCw } from 'lucide-react';
import api from '../../../services/api';
import toast from 'react-hot-toast';

interface McpApiKey {
  id: string;
  keyPrefix: string;
  label: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
}

interface GeneratedKey {
  id: string;
  key: string;
  keyPrefix: string;
  label: string;
  expiresAt: string;
  mcpConfig: Record<string, unknown>;
}

export const McpIntegration: React.FC = () => {
  const [keys, setKeys] = useState<McpApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<GeneratedKey | null>(null);
  const [generating, setGenerating] = useState(false);
  const [label, setLabel] = useState('');
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedConfig, setCopiedConfig] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [showRevokeConfirm, setShowRevokeConfirm] = useState<McpApiKey | null>(null);

  const fetchKeys = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.get('/api/mcp-keys');
      setKeys(res.data.keys);
    } catch {
      setError('Failed to load API keys');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchKeys(); }, [fetchKeys]);

  const handleGenerate = async () => {
    if (!label.trim()) return;
    try {
      setGenerating(true);
      const res = await api.post('/api/mcp-keys', { label: label.trim() });
      setGeneratedKey(res.data);
      fetchKeys();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to generate key');
      setShowGenerateModal(false);
    } finally {
      setGenerating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    try {
      setRevoking(id);
      await api.delete(`/api/mcp-keys/${id}`);
      toast.success('API key revoked');
      setShowRevokeConfirm(null);
      fetchKeys();
    } catch {
      toast.error('Failed to revoke key');
    } finally {
      setRevoking(null);
    }
  };

  const copyToClipboard = async (text: string, type: 'key' | 'config') => {
    await navigator.clipboard.writeText(text);
    if (type === 'key') { setCopiedKey(true); setTimeout(() => setCopiedKey(false), 2000); }
    else { setCopiedConfig(true); setTimeout(() => setCopiedConfig(false), 2000); }
  };

  const formatDate = (date: string) => {
    const d = new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 30) return `${diffDays} days ago`;
    return d.toLocaleDateString();
  };

  // Empty state
  if (!loading && !error && keys.length === 0 && !showGenerateModal) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8">
        <div className="text-center max-w-md mx-auto py-8">
          <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Bot className="w-8 h-8 text-blue-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Connect an AI assistant to your business data</h3>
          <p className="text-sm text-gray-500 mb-6">
            Query your orders, customers, deliveries, and revenue using natural language.
            Generate an API key to connect any MCP-compatible AI assistant to your account.
          </p>
          <button
            onClick={() => { setLabel(''); setGeneratedKey(null); setShowGenerateModal(true); }}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
          >
            <Key className="w-4 h-4" />
            Generate API Key
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900">AI Assistant</h3>
          <p className="text-xs text-gray-500 mt-0.5">Connect an AI assistant to query your business data</p>
        </div>
        <button
          onClick={() => { setLabel(''); setGeneratedKey(null); setShowGenerateModal(true); }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
        >
          <Plus className="w-3.5 h-3.5" />
          Generate Key
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="p-6 space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-6">
          <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
            <span className="text-sm text-red-700">{error}</span>
            <button onClick={fetchKeys} className="ml-auto text-sm text-red-600 hover:text-red-800 font-medium flex items-center gap-1">
              <RefreshCw className="w-3.5 h-3.5" /> Retry
            </button>
          </div>
        </div>
      )}

      {/* Key list */}
      {!loading && !error && keys.length > 0 && (
        <div className="divide-y divide-gray-100">
          {keys.map((k) => (
            <div key={k.id} className="px-6 py-3.5 flex items-center gap-4">
              <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <Key className="w-4 h-4 text-gray-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900">{k.label}</div>
                <div className="text-xs text-gray-400 font-mono">{k.keyPrefix}...****</div>
              </div>
              <div className="text-xs text-gray-400 hidden sm:block">{formatDate(k.createdAt)}</div>
              {k.lastUsedAt && (
                <div className="text-xs text-gray-400 hidden md:block">Last used {formatDate(k.lastUsedAt)}</div>
              )}
              <button
                onClick={() => setShowRevokeConfirm(k)}
                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                title="Revoke key"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Generate Modal */}
      {showGenerateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={(e) => { if (e.target === e.currentTarget && !generatedKey) setShowGenerateModal(false); }}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              {!generatedKey ? (
                <>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Generate API Key</h3>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Label</label>
                  <input
                    type="text"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="e.g., My MacBook AI Assistant"
                    maxLength={50}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    autoFocus
                    onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
                  />
                  <div className="flex gap-3 mt-6">
                    <button onClick={() => setShowGenerateModal(false)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
                      Cancel
                    </button>
                    <button
                      onClick={handleGenerate}
                      disabled={!label.trim() || generating}
                      className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {generating ? <><RefreshCw className="w-4 h-4 animate-spin" /> Generating...</> : 'Generate'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">Your API Key</h3>
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-amber-800">This key will only be shown once. Store it securely.</p>
                  </div>

                  <label className="block text-xs font-medium text-gray-500 mb-1">API Key</label>
                  <div className="flex items-center gap-2 mb-4">
                    <code className="flex-1 bg-gray-900 text-green-400 px-3 py-2 rounded-lg text-xs font-mono break-all">{generatedKey.key}</code>
                    <button
                      onClick={() => copyToClipboard(generatedKey.key, 'key')}
                      className="p-2 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors flex-shrink-0"
                      title="Copy key"
                    >
                      {copiedKey ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4 text-gray-600" />}
                    </button>
                  </div>

                  <label className="block text-xs font-medium text-gray-500 mb-1">MCP Client Config</label>
                  <div className="flex items-start gap-2 mb-4">
                    <pre className="flex-1 bg-gray-900 text-gray-300 px-3 py-2 rounded-lg text-xs font-mono overflow-x-auto whitespace-pre">
{JSON.stringify(generatedKey.mcpConfig, null, 2)}
                    </pre>
                    <button
                      onClick={() => copyToClipboard(JSON.stringify(generatedKey.mcpConfig, null, 2), 'config')}
                      className="p-2 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors flex-shrink-0 mt-1"
                      title="Copy config"
                    >
                      {copiedConfig ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4 text-gray-600" />}
                    </button>
                  </div>

                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                    <p className="text-xs font-medium text-blue-800 mb-2">Setup Instructions:</p>
                    <ol className="text-xs text-blue-700 space-y-1 list-decimal list-inside">
                      <li>Open your MCP client's settings (e.g., Claude Desktop, Cursor)</li>
                      <li>Find the MCP server configuration</li>
                      <li>Paste the config JSON above</li>
                      <li>Update the path to your backend's dist/mcp/server.js</li>
                      <li>Restart the client</li>
                    </ol>
                  </div>

                  <button
                    onClick={() => { setShowGenerateModal(false); setGeneratedKey(null); }}
                    className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                  >
                    I've saved this key
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Revoke Confirmation */}
      {showRevokeConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Revoke API Key</h3>
            <p className="text-sm text-gray-600 mb-1">
              Revoke key <span className="font-medium">"{showRevokeConfirm.label}"</span>?
            </p>
            <p className="text-xs text-gray-500 mb-4">
              Any AI assistant using this key will immediately lose access. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowRevokeConfirm(null)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={() => handleRevoke(showRevokeConfirm.id)}
                disabled={revoking === showRevokeConfirm.id}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {revoking === showRevokeConfirm.id ? <><RefreshCw className="w-4 h-4 animate-spin" /> Revoking...</> : 'Revoke'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
