import { useEffect, useState } from 'react';
import { useSession } from '../lib/auth-client';
import { useNavigate } from 'react-router-dom';
import { Shield, Users, Image, Settings, Loader2, AlertCircle } from 'lucide-react';

export function Admin() {
  const { data: session, isPending } = useSession();
  const navigate = useNavigate();
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPending && !session) {
      navigate('/login');
    } else if (!isPending && session && (session.user as any).role !== 'admin') {
      navigate('/');
    }
  }, [session, isPending, navigate]);

  useEffect(() => {
    async function fetchAdminData() {
      if (!session) return;
      
      try {
        const response = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/admin/status`, {
            headers: {
                'Authorization': `Bearer ${session.session.token}`
            }
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
    }

    if (session) {
        fetchAdminData();
    }
  }, [session]);

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
    <div className="w-full max-w-6xl">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white">
          <Shield size={22} />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Admin Dashboard</h2>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Privileged access for {session.user.email}</p>
        </div>
      </div>

      {error && (
        <div className="mb-8 p-4 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 rounded-xl flex items-start gap-3 text-red-600 dark:text-red-400">
          <AlertCircle size={20} className="shrink-0 mt-0.5" />
          <p>Error: {error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        <div className="p-6 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">
          <div className="w-10 h-10 bg-blue-50 dark:bg-blue-900/20 rounded-lg flex items-center justify-center text-blue-600 dark:text-blue-400 mb-4">
            <Image size={20} />
          </div>
          <h3 className="text-gray-500 dark:text-gray-400 text-sm font-medium mb-1">Total Images</h3>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">--</p>
        </div>

        <div className="p-6 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">
          <div className="w-10 h-10 bg-green-50 dark:bg-green-900/20 rounded-lg flex items-center justify-center text-green-600 dark:text-green-400 mb-4">
            <Users size={20} />
          </div>
          <h3 className="text-gray-500 dark:text-gray-400 text-sm font-medium mb-1">Total Users</h3>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">1</p>
        </div>

        <div className="p-6 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">
          <div className="w-10 h-10 bg-purple-50 dark:bg-purple-900/20 rounded-lg flex items-center justify-center text-purple-600 dark:text-purple-400 mb-4">
            <Settings size={20} />
          </div>
          <h3 className="text-gray-500 dark:text-gray-400 text-sm font-medium mb-1">Server Status</h3>
          <p className="text-2xl font-bold text-green-500">{stats?.status || 'Online'}</p>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm p-8 text-center">
        <Shield size={48} className="mx-auto text-gray-300 dark:text-gray-700 mb-4" />
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Admin Tools</h3>
        <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto">
          More administrative features like user management, system logs, and global image deletion will be added in future updates.
        </p>
      </div>
    </div>
  );
}
