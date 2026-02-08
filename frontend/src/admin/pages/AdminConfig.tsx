import { useState, useEffect, useCallback } from 'react';
import { useAdminApi } from '../hooks/useAdminApi';

interface ConfigEntry {
  key: string;
  value: string;
  value_type: string;
  description?: { String: string; Valid: boolean } | string;
  updated_by?: { String: string; Valid: boolean } | string;
  updated_at: string;
}

function getStringValue(val: { String: string; Valid: boolean } | string | undefined): string {
  if (!val) return '';
  if (typeof val === 'string') return val;
  return val.Valid ? val.String : '';
}

export function AdminConfig() {
  const { get, put } = useAdminApi();

  const [configs, setConfigs] = useState<ConfigEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  const loadConfigs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await get('/config');
      setConfigs(data.configs || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load config');
    } finally {
      setLoading(false);
    }
  }, [get]);

  useEffect(() => { loadConfigs(); }, [loadConfigs]);

  const handleEdit = (config: ConfigEntry) => {
    setEditingKey(config.key);
    setEditValue(config.value);
  };

  const handleSave = async () => {
    if (!editingKey) return;
    setSaving(true);
    setError(null);
    try {
      await put(`/config/${editingKey}`, { value: editValue });
      setEditingKey(null);
      setEditValue('');
      loadConfigs();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update config');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditingKey(null);
    setEditValue('');
  };

  if (loading) {
    return (
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-4">Configuration</h2>
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#373536] mx-auto"></div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-4">Configuration</h2>
      <p className="text-sm text-gray-500 mb-6">
        Runtime configuration values. Changes take effect immediately.
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">{error}</div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Key</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Value</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Updated</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {configs.map((config) => (
              <tr key={config.key}>
                <td className="px-4 py-3 text-sm font-mono font-medium text-gray-900">
                  {config.key}
                </td>
                <td className="px-4 py-3 text-sm">
                  {editingKey === config.key ? (
                    <input
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSave();
                        if (e.key === 'Escape') handleCancel();
                      }}
                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-[#373536] focus:border-transparent"
                      autoFocus
                    />
                  ) : (
                    <span className="font-semibold text-gray-900">{config.value}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-gray-500">{config.value_type}</td>
                <td className="px-4 py-3 text-xs text-gray-500 max-w-xs">
                  {getStringValue(config.description) || '—'}
                </td>
                <td className="px-4 py-3 text-xs text-gray-500">
                  <div>{getStringValue(config.updated_by) || '—'}</div>
                  <div>{new Date(config.updated_at).toLocaleString()}</div>
                </td>
                <td className="px-4 py-3 text-sm">
                  {editingKey === config.key ? (
                    <div className="flex gap-1">
                      <button
                        onClick={handleSave}
                        disabled={saving}
                        className="px-2 py-1 text-xs font-medium text-white bg-[#373536] rounded hover:bg-[#2c2b2a] disabled:opacity-50"
                      >
                        {saving ? '...' : 'Save'}
                      </button>
                      <button
                        onClick={handleCancel}
                        disabled={saving}
                        className="px-2 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleEdit(config)}
                      className="px-2 py-1 text-xs font-medium text-[#373536] bg-white border border-gray-300 rounded hover:bg-gray-50"
                    >
                      Edit
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
