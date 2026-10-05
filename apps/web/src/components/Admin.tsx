import { useEffect, useState } from 'react';
import { useSession } from '../lib/auth-client';
import { useNavigate } from 'react-router-dom';
import {
  Shield,
  Users,
  Image,
  Settings,
  Loader2,
  AlertCircle,
  Key,
  Plus,
  Trash2,
  Copy,
  Check,
  Terminal,
  Bot,
  Info,
} from 'lucide-react';

interface ApiKeyItem {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

interface NewKeyResponse {
  id: string;
  name: string;
  key: string;
  keyPrefix: string;
  createdAt: string;
  expiresAt: string | null;
}

export function Admin() {
  const { data: session, isPending } = useSession();
  const navigate = useNavigate();
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // API Keys state
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([]);
  const [keysLoading, setKeysLoading] = useState(false);
  const [isCreatingKey, setIsCreatingKey] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyExpires, setNewKeyExpires] = useState<string>('0');
  const [creatingInProgress, setCreatingInProgress] = useState(false);
  const [createdKey, setCreatedKey] = useState<NewKeyResponse | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  const apiBase = import.meta.env.VITE_API_URL || '';

  useEffect(() => {
    if (!isPending && !session) {
      navigate('/login');
    } else if (!isPending && session && (session.user as any).role !== 'admin') {
      navigate('/');
    }
  }, [session, isPending, navigate]);

  const fetchAdminData = async () => {
    if (!session) return;
    try {
      const response = await fetch(`${apiBase}/api/admin/status`, {
        headers: {
          Authorization: `Bearer ${session.session.token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch admin data');
      }

      const data = await response.json();
      setStats(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchApiKeys = async () => {
    if (!session) return;
    setKeysLoading(true);
    setKeyError(null);
    try {
      const res = await fetch(`${apiBase}/api/user/api-keys`, {
        headers: {
          Authorization: `Bearer ${session.session.token}`,
        },
      });
      if (!res.ok) {
        throw new Error('Failed to fetch API keys');
      }
      const data = await res.json();
      setApiKeys(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setKeyError(err.message);
    } finally {
      setKeysLoading(false);
    }
  };

  useEffect(() => {
    if (session) {
      fetchAdminData();
      fetchApiKeys();
    }
  }, [session]);

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    setCreatingInProgress(true);
    setKeyError(null);
    try {
      const expiresDays = parseInt(newKeyExpires, 10);
      const res = await fetch(`${apiBase}/api/user/api-keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.session.token}`,
        },
        body: JSON.stringify({
          name: newKeyName.trim() || 'Agent Key',
          expiresDays: expiresDays > 0 ? expiresDays : undefined,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to create API key');
      }

      const data: NewKeyResponse = await res.json();
      setCreatedKey(data);
      setNewKeyName('');
      setIsCreatingKey(false);
      await fetchApiKeys();
    } catch (err: any) {
      setKeyError(err.message);
    } finally {
      setCreatingInProgress(false);
    }
  };

  const handleDeleteKey = async (id: string) => {
    if (!session) return;
    if (!confirm('Are you sure you want to revoke this API key? External agents using it will immediately lose access.')) {
      return;
    }
    setKeyError(null);
    try {
      const res = await fetch(`${apiBase}/api/user/api-keys/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${session.session.token}`,
        },
      });

      if (!res.ok) {
        throw new Error('Failed to delete API key');
      }
      await fetchApiKeys();
    } catch (err: any) {
      setKeyError(err.message);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2500);
  };

  if (isPending || (session && loading)) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <Loader2 size={40} className="text-blue-600 animate-spin mb-4" />
        <p className="text-gray-500">Verifying admin access...</p>
      </div>
    );
  }

  if (!session || (session.user as any).role !== 'admin') {
    return null;
  }

  return (
    <div className="w-full max-w-6xl mx-auto space-y-8 pb-16">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-sm">
          <Shield size={22} />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Admin Dashboard</h2>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Privileged access for {session.user.email}</p>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 rounded-xl flex items-start gap-3 text-red-600 dark:text-red-400">
          <AlertCircle size={20} className="shrink-0 mt-0.5" />
          <p>Error: {error}</p>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="p-6 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">
          <div className="w-10 h-10 bg-blue-50 dark:bg-blue-900/20 rounded-lg flex items-center justify-center text-blue-600 dark:text-blue-400 mb-4">
            <Image size={20} />
          </div>
          <h3 className="text-gray-500 dark:text-gray-400 text-sm font-medium mb-1">Total Images</h3>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{stats?.totalImages ?? '--'}</p>
        </div>

        <div className="p-6 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">
          <div className="w-10 h-10 bg-green-50 dark:bg-green-900/20 rounded-lg flex items-center justify-center text-green-600 dark:text-green-400 mb-4">
            <Users size={20} />
          </div>
          <h3 className="text-gray-500 dark:text-gray-400 text-sm font-medium mb-1">Total Users</h3>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{stats?.totalUsers ?? '1'}</p>
        </div>

        <div className="p-6 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">
          <div className="w-10 h-10 bg-purple-50 dark:bg-purple-900/20 rounded-lg flex items-center justify-center text-purple-600 dark:text-purple-400 mb-4">
            <Settings size={20} />
          </div>
          <h3 className="text-gray-500 dark:text-gray-400 text-sm font-medium mb-1">Server Status</h3>
          <p className="text-2xl font-bold text-green-500">{stats?.status || 'Online'}</p>
        </div>
      </div>

      {/* API Key Management Section */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm p-6 sm:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 dark:border-gray-800 pb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 rounded-xl flex items-center justify-center">
              <Key size={20} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">API Keys & Agent Access</h3>
              <p className="text-gray-500 dark:text-gray-400 text-sm">
                Generate persistent API keys (<code className="font-mono text-xs">drop_sec_...</code>) for external AI agents, CLI tools, and MCP servers.
              </p>
            </div>
          </div>
          {!isCreatingKey && (
            <button
              onClick={() => setIsCreatingKey(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition shadow-sm self-start sm:self-auto cursor-pointer"
            >
              <Plus size={16} />
              Create API Key
            </button>
          )}
        </div>

        {keyError && (
          <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 rounded-xl flex items-start gap-3 text-red-600 dark:text-red-400 text-sm">
            <AlertCircle size={18} className="shrink-0 mt-0.5" />
            <p>{keyError}</p>
          </div>
        )}

        {/* Just Created Key Banner */}
        {createdKey && (
          <div className="p-5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-2xl space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="inline-block px-2 py-0.5 bg-amber-200 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300 text-xs font-semibold rounded-md mb-1">
                  New API Key Generated: {createdKey.name}
                </span>
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  Make sure to copy your API key now. For your security, it will <strong>never be shown again</strong>.
                </p>
              </div>
              <button
                onClick={() => setCreatedKey(null)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-sm font-medium px-2 py-1"
              >
                Dismiss
              </button>
            </div>

            <div className="flex items-center gap-2 bg-white dark:bg-gray-950 p-2.5 rounded-xl border border-amber-200 dark:border-amber-900/40">
              <code className="flex-1 font-mono text-sm text-gray-800 dark:text-gray-200 break-all select-all">
                {createdKey.key}
              </code>
              <button
                onClick={() => copyToClipboard(createdKey.key)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition shrink-0 cursor-pointer"
              >
                {copiedKey ? (
                  <>
                    <Check size={14} />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy size={14} />
                    <span>Copy Key</span>
                  </>
                )}
              </button>
            </div>

            <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
              <Bot size={14} />
              <span>Pass in headers: <code className="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded font-mono text-[11px]">Authorization: Bearer {createdKey.key}</code></span>
            </div>
          </div>
        )}

        {/* Create Key Form */}
        {isCreatingKey && (
          <form onSubmit={handleCreateKey} className="p-4 bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-800 rounded-xl space-y-4">
            <h4 className="font-semibold text-sm text-gray-900 dark:text-white">Create New API Key</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Key Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Claude Desktop, Codex Agent, CLI"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Expiration
                </label>
                <select
                  value={newKeyExpires}
                  onChange={(e) => setNewKeyExpires(e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white"
                >
                  <option value="0">Never expires</option>
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                  <option value="365">1 year</option>
                </select>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsCreatingKey(false)}
                className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creatingInProgress}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition cursor-pointer"
              >
                {creatingInProgress ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                Generate Key
              </button>
            </div>
          </form>
        )}

        {/* Existing Keys Table */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Active API Keys</h4>
          {keysLoading ? (
            <div className="py-8 flex justify-center items-center text-gray-400">
              <Loader2 size={24} className="animate-spin mr-2" />
              <span className="text-sm">Loading keys...</span>
            </div>
          ) : apiKeys.length === 0 ? (
            <div className="p-8 text-center border border-dashed border-gray-200 dark:border-gray-800 rounded-xl text-gray-500 dark:text-gray-400 text-sm">
              <Key size={32} className="mx-auto text-gray-300 dark:text-gray-700 mb-2" />
              <p className="font-medium text-gray-700 dark:text-gray-300">No active API keys found</p>
              <p className="text-xs text-gray-400 mt-1">
                Click "Create API Key" above to generate your first key for an external agent.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800/60 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-800">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Key Prefix</th>
                    <th className="px-4 py-3">Created</th>
                    <th className="px-4 py-3">Last Used</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800/50">
                  {apiKeys.map((k) => (
                    <tr key={k.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition">
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{k.name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500 dark:text-gray-400">
                        {k.keyPrefix}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                        {new Date(k.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                        {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : 'Never'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleDeleteKey(k.id)}
                          className="text-red-500 hover:text-red-700 p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 transition cursor-pointer"
                          title="Revoke key"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Instructions & Quick Reference for AI Agents */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm p-6 sm:p-8 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-xl flex items-center justify-center">
            <Terminal size={20} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Connecting External AI Agents</h3>
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              Use your API key or server tokens to connect AI tools to DropImg.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          {/* MCP Integration Card */}
          <div className="p-4 bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-800 rounded-xl space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
              <Bot size={16} className="text-blue-500" />
              <span>Model Context Protocol (MCP)</span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              DropImg exposes native tools: <code className="font-mono text-[11px]">upload_image</code>, <code className="font-mono text-[11px]">upload_video</code>, <code className="font-mono text-[11px]">get_image</code>, <code className="font-mono text-[11px]">request_upload_url</code>.
            </p>
            <div className="bg-gray-900 p-2.5 rounded-lg text-[11px] font-mono text-gray-200 overflow-x-auto">
              <p className="text-gray-400">// Remote MCP Endpoint</p>
              <p className="text-green-400">https://img.buildwithmatija.com/api/mcp</p>
              <p className="text-gray-400 mt-1">// Header</p>
              <p className="text-amber-300">Authorization: Bearer drop_sec_...</p>
            </div>
          </div>

          {/* Direct API Upload Card */}
          <div className="p-4 bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-800 rounded-xl space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
              <Terminal size={16} className="text-emerald-500" />
              <span>Direct Video / Image Upload</span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Upload videos (MP4, WebM, MOV) or images with multipart form data:
            </p>
            <div className="bg-gray-900 p-2.5 rounded-lg text-[11px] font-mono text-gray-200 overflow-x-auto whitespace-pre">
{`curl -X POST https://img.buildwithmatija.com/api/upload \\
  -H "Authorization: Bearer drop_sec_..." \\
  -F "file=@demo.mp4" \\
  -F "altName=My Video"`}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-2 text-xs text-gray-500 dark:text-gray-400">
          <Info size={14} className="shrink-0" />
          <span>
            Agent reference documentation is automatically available at{' '}
            <a
              href="/llms.txt"
              target="_blank"
              rel="noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:underline font-mono"
            >
              /llms.txt
            </a>{' '}
            and{' '}
            <a
              href="/llms-full.txt"
              target="_blank"
              rel="noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:underline font-mono"
            >
              /llms-full.txt
            </a>.
          </span>
        </div>
      </div>
    </div>
  );
}
