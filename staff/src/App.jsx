import { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import './App.css';

// Worker secret passcode (checks env variable or defaults to NOIR123)
const STAFF_PASSCODE = import.meta.env.VITE_STAFF_PASSCODE || 'NOIR123';

// Bell chime audio generator using Web Audio API
const playChime = () => {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, ctx.currentTime);
    gain1.gain.setValueAtTime(0.15, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start();
    osc1.stop(ctx.currentTime + 0.6);

    setTimeout(() => {
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1318.51, ctx.currentTime);
      gain2.gain.setValueAtTime(0.1, ctx.currentTime);
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
      
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start();
      osc2.stop(ctx.currentTime + 0.8);
    }, 120);
  } catch (err) {
    console.warn('Audio synthesis failed:', err);
  }
};

// Helper function to extract food items, tips, and subtotal dynamically from the database record
const getOrderBreakdown = (order) => {
  let subtotal = 0;
  let tipAmount = 0;
  const foodItems = [];
  
  order?.items?.forEach((item) => {
    if (item.id === 'tip' || item.name?.includes('Tip')) {
      tipAmount += item.price * item.quantity;
    } else {
      subtotal += item.price * item.quantity;
      foodItems.push(item);
    }
  });
  
  return {
    subtotal,
    tipAmount,
    foodItems,
    total: order?.total || (subtotal + tipAmount)
  };
};

// Check if two orders/groups should be merged based on guest, table, and time-based meal completion
const shouldMergeOrders = (group, order) => {
  if ((group.table_number || '').toString().trim() !== (order.table_number || '').toString().trim() ||
      (group.guest_name || '').toString().trim().toLowerCase() !== (order.guest_name || '').toString().trim().toLowerCase()) {
    return false;
  }

  const orderCreatedTime = new Date(order.created_at).getTime();

  // If any previous order in the group was already completed (marked ready/paid) before this order was placed, keep them separate
  const hasAlreadyCompletedMeal = group.rawOrders.some(prevOrder => {
    if (prevOrder.status === 'ready' || prevOrder.status === 'paid') {
      const prevCompletedTime = new Date(prevOrder.updated_at).getTime();
      // Add a small grace threshold of 10 seconds just in case timestamps are extremely close
      if (orderCreatedTime > prevCompletedTime + 10000) {
        return true;
      }
    }
    return false;
  });

  if (hasAlreadyCompletedMeal) {
    return false;
  }

  return true;
};

// Generic order grouping & merging function
const getMergedOrdersList = (ordersList) => {
  const merged = [];
  
  ordersList.forEach(order => {
    const group = merged.find(g => shouldMergeOrders(g, order));
    
    if (!group) {
      merged.push({
        id: order.id,
        ids: [order.id],
        table_number: order.table_number,
        guest_name: order.guest_name,
        created_at: order.created_at,
        updated_at: order.updated_at,
        items: JSON.parse(JSON.stringify(order.items || [])),
        total: order.total || 0,
        order_no: order.order_no,
        order_nos: [order.order_no].filter(Boolean),
        status: order.status,
        rawOrders: [order]
      });
    } else {
      group.ids.push(order.id);
      if (order.order_no) {
        group.order_nos.push(order.order_no);
      }
      
      // Merge items list
      const newItems = order.items || [];
      newItems.forEach(newItem => {
        const existingItem = group.items.find(item => item.id === newItem.id);
        if (existingItem) {
          existingItem.quantity += newItem.quantity;
        } else {
          group.items.push({ ...newItem });
        }
      });
      
      // Sum totals
      group.total += (order.total || 0);
      
      // Retain earliest created_at
      if (new Date(order.created_at) < new Date(group.created_at)) {
        group.created_at = order.created_at;
      }
      // Retain latest updated_at
      if (new Date(order.updated_at) > new Date(group.updated_at)) {
        group.updated_at = order.updated_at;
      }
      group.rawOrders.push(order);
    }
  });
  
  return merged;
};

const getMergedReadyOrders = (readyOrders) => {
  return getMergedOrdersList(readyOrders);
};

// Group completed sales history by guest name and payment timestamp (10 mins gap)
const getMergedSalesHistory = (paidOrdersList) => {
  const merged = [];
  
  // Sort by updated_at descending (most recent checkout first)
  const sorted = [...paidOrdersList].sort((a, b) => 
    new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );
  
  sorted.forEach(order => {
    const orderTime = new Date(order.updated_at).getTime();
    
    // Find an existing group in 'merged' that matches:
    // 1. Same guest name (case-insensitive, trimmed)
    // 2. Difference between this order's checkout time and the group's checkout time is <= 10 minutes (600000 ms)
    const group = merged.find(g => {
      const isSameGuest = (g.guest_name || '').toString().trim().toLowerCase() === (order.guest_name || '').toString().trim().toLowerCase();
      if (!isSameGuest) return false;
      
      const groupTime = new Date(g.updated_at).getTime();
      const timeGap = Math.abs(groupTime - orderTime);
      return timeGap <= 10 * 60 * 1000; // 10 minutes threshold
    });
    
    if (!group) {
      merged.push({
        id: order.id,
        ids: [order.id],
        table_number: order.table_number ? order.table_number.toString().trim() : '',
        table_numbers: order.table_number ? [order.table_number.toString().trim()] : [],
        guest_name: order.guest_name,
        created_at: order.created_at,
        updated_at: order.updated_at,
        items: JSON.parse(JSON.stringify(order.items || [])),
        total: order.total || 0,
        order_no: order.order_no,
        order_nos: [order.order_no].filter(Boolean),
        payment_method: order.payment_method,
        rawOrders: [order]
      });
    } else {
      group.ids.push(order.id);
      if (order.order_no) {
        group.order_nos.push(order.order_no);
      }
      
      const tblStr = order.table_number ? order.table_number.toString().trim() : '';
      if (tblStr && !group.table_numbers.includes(tblStr)) {
        group.table_numbers.push(tblStr);
      }
      group.table_number = group.table_numbers.join(', ');
      
      // Merge items list
      const newItems = order.items || [];
      newItems.forEach(newItem => {
        const existingItem = group.items.find(item => item.id === newItem.id);
        if (existingItem) {
          existingItem.quantity += newItem.quantity;
        } else {
          group.items.push({ ...newItem });
        }
      });
      
      // Sum totals
      group.total += (order.total || 0);
      
      // Retain earliest created_at for overall visit span
      if (new Date(order.created_at) < new Date(group.created_at)) {
        group.created_at = order.created_at;
      }
      // Keep latest updated_at for group time reference
      if (new Date(order.updated_at) > new Date(group.updated_at)) {
        group.updated_at = order.updated_at;
      }
      group.rawOrders.push(order);
    }
  });
  
  return merged;
};

function App() {
  // Security Locks
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [passcodeBuffer, setPasscodeBuffer] = useState('');
  const [authError, setAuthError] = useState('');

  // Dashboard state
  const [activeView, setActiveView] = useState('kitchen'); // 'kitchen', 'floor', 'history', 'admin'
  const [orders, setOrders] = useState([]);
  const [paidOrders, setPaidOrders] = useState([]); // populated when history tab is loaded
  const [dbConnected, setDbConnected] = useState(true);
  
  // Waiter settlement state
  const [selectedOrderForSettle, setSelectedOrderForSettle] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState('online');
  
  const [newOrderAlert, setNewOrderAlert] = useState(null);
  const [newOrderIds, setNewOrderIds] = useState(new Set());

  // Admin / Manager panel state
  const [showAdminUnlockModal, setShowAdminUnlockModal] = useState(false);
  const [adminUnlockBuffer, setAdminUnlockBuffer] = useState('');
  const [adminUnlockError, setAdminUnlockError] = useState('');
  const [showClearConfirmModal, setShowClearConfirmModal] = useState(false);
  const [clearConfirmType, setClearConfirmType] = useState('paid'); // 'paid' or 'all'
  const [clearConfirmInput, setClearConfirmInput] = useState('');
  const [adminError, setAdminError] = useState('');
  const [isClearing, setIsClearing] = useState(false);

  // Editing and Merging Sales History State
  const [selectedHistoryIds, setSelectedHistoryIds] = useState([]);
  const [editingOrder, setEditingOrder] = useState(null); // single order to edit
  const [editGuestName, setEditGuestName] = useState('');
  const [editTableNumber, setEditTableNumber] = useState('');
  const [editPaymentMethod, setEditPaymentMethod] = useState('online');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [mergeTargetGroupId, setMergeTargetGroupId] = useState('');

  const [showMergeConfirmModal, setShowMergeConfirmModal] = useState(false);
  const [mergeGuestName, setMergeGuestName] = useState('');
  const [mergeTableNumber, setMergeTableNumber] = useState('');
  const [mergePaymentMethod, setMergePaymentMethod] = useState('online');
  const [isMerging, setIsMerging] = useState(false);
  
  const initialFetchDone = useRef(false);

  // Check login on load
  useEffect(() => {
    const isLogged = localStorage.getItem('noir_dashboard_auth') === 'true';
    const isAdminLogged = localStorage.getItem('noir_dashboard_admin') === 'true';
    if (isLogged) {
      setIsAuthenticated(true);
      if (isAdminLogged) {
        setIsAdmin(true);
      }
    }
  }, []);

  // Fetch active orders and set up real-time subscription
  useEffect(() => {
    // 1. Initial Fetch of active orders (where status is not paid)
    const fetchOrders = async () => {
      try {
        const { data, error } = await supabase
          .from('orders')
          .select('*')
          .neq('status', 'paid')
          .order('created_at', { ascending: true });

        if (error) throw error;
        setOrders(data || []);
        initialFetchDone.current = true;
      } catch (err) {
        console.error('Error fetching initial orders:', err);
        setDbConnected(false);
      }
    };

    fetchOrders();

    // 2. Realtime listener
    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        (payload) => {
          const { eventType, new: newRecord, old: oldRecord } = payload;
          
          if (eventType === 'INSERT') {
            setOrders((prev) => {
              if (prev.some((o) => o.id === newRecord.id)) return prev;
              return [...prev, newRecord];
            });

            if (initialFetchDone.current) {
              playChime();
              setNewOrderAlert(`Table ${newRecord.table_number} placed a new order!`);
              setNewOrderIds((prev) => {
                const next = new Set(prev);
                next.add(newRecord.id);
                return next;
              });
              
              setTimeout(() => {
                setNewOrderIds((prev) => {
                  const next = new Set(prev);
                  next.delete(newRecord.id);
                  return next;
                });
              }, 15000);
            }
          } 
          else if (eventType === 'UPDATE') {
            if (newRecord.status === 'paid') {
              // Remove paid orders from active view list
              setOrders((prev) => prev.filter((o) => o.id !== newRecord.id));
              
              // Automatically push into history list if it is loaded
              setPaidOrders((prev) => {
                if (prev.length === 0) return prev; // history not loaded yet
                if (prev.some((o) => o.id === newRecord.id)) return prev;
                return [newRecord, ...prev];
              });

              setSelectedOrderForSettle((prev) => {
                if (!prev) return null;
                const targetIds = prev.ids || [prev.id];
                if (targetIds.includes(newRecord.id)) return null;
                return prev;
              });
            } else {
              setOrders((prev) =>
                prev.map((o) => (o.id === newRecord.id ? newRecord : o))
              );
              setSelectedOrderForSettle((prev) => {
                if (!prev) return null;
                const targetIds = prev.ids || [prev.id];
                if (targetIds.includes(newRecord.id)) {
                  // If one of the orders in the selected group changes status, reset selection to avoid inconsistent total
                  return null;
                }
                return prev;
              });
            }
          } 
          else if (eventType === 'DELETE') {
            setOrders((prev) => prev.filter((o) => o.id !== oldRecord.id));
            setPaidOrders((prev) => prev.filter((o) => o.id !== oldRecord.id));
            setSelectedOrderForSettle((prev) => {
              if (!prev) return null;
              const targetIds = prev.ids || [prev.id];
              if (targetIds.includes(oldRecord.id)) return null;
              return prev;
            });
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setDbConnected(true);
        } else {
          setDbConnected(false);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Fetch Paid sales history
  const fetchSalesHistory = async () => {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('status', 'paid')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setPaidOrders(data || []);
    } catch (err) {
      console.error('Error fetching sales history:', err);
    }
  };

  // Trigger history fetch when view tab switches to 'history'
  useEffect(() => {
    if (activeView === 'history' && isAuthenticated) {
      fetchSalesHistory();
    }
  }, [activeView, isAuthenticated]);

  // Editing and Merging Sales History Handlers
  const handleToggleHistorySelection = (groupId) => {
    setSelectedHistoryIds(prev => 
      prev.includes(groupId) 
        ? prev.filter(id => id !== groupId) 
        : [...prev, groupId]
    );
  };

  const handleToggleAllHistory = (mergedPaidOrdersList) => {
    if (selectedHistoryIds.length === mergedPaidOrdersList.length) {
      setSelectedHistoryIds([]);
    } else {
      setSelectedHistoryIds(mergedPaidOrdersList.map(o => o.id));
    }
  };

  const getSelectedRawOrders = (mergedPaidOrdersList) => {
    const selectedGroups = mergedPaidOrdersList.filter(o => selectedHistoryIds.includes(o.id));
    const rawOrders = [];
    selectedGroups.forEach(g => {
      if (g.rawOrders) {
        rawOrders.push(...g.rawOrders);
      }
    });
    return rawOrders;
  };

  const handleOpenEditModal = (order) => {
    setEditingOrder(order);
    setEditGuestName(order.guest_name || '');
    setEditTableNumber(order.table_number || '');
    setEditPaymentMethod(order.payment_method || 'online');
    setMergeTargetGroupId('');
  };

  const handleSaveEdit = async () => {
    if (!editingOrder) return;
    setIsSavingEdit(true);
    try {
      const targetIds = editingOrder.ids || [editingOrder.id];
      const { error } = await supabase
        .from('orders')
        .update({
          guest_name: editGuestName,
          table_number: editTableNumber,
          payment_method: editPaymentMethod,
          updated_at: new Date().toISOString()
        })
        .in('id', targetIds);

      if (error) throw error;
      
      playChime();
      setEditingOrder(null);
      fetchSalesHistory();
    } catch (err) {
      console.error('Error editing bill:', err);
      alert('Failed to edit bill: ' + err.message);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleOpenMergeModal = (mergedPaidOrdersList) => {
    const selectedGroups = mergedPaidOrdersList.filter(o => selectedHistoryIds.includes(o.id));
    if (selectedGroups.length < 2) {
      alert("Please select at least 2 bills to merge.");
      return;
    }
    
    const allTables = Array.from(new Set(selectedGroups.map(g => g.table_number).filter(Boolean)));
    const allGuests = Array.from(new Set(selectedGroups.map(g => g.guest_name).filter(Boolean)));
    
    setMergeGuestName(allGuests.join(' & '));
    setMergeTableNumber(allTables.join(', '));
    setMergePaymentMethod(selectedGroups[0].payment_method || 'online');
    setShowMergeConfirmModal(true);
  };

  const handleOpenMergeModalForTwo = (orderA, orderB) => {
    const allGuests = [orderA.guest_name, orderB.guest_name].filter(Boolean);
    const allTables = [orderA.table_number, orderB.table_number].filter(Boolean);
    
    const uniqueGuests = Array.from(new Set(allGuests));
    const uniqueTables = Array.from(new Set(allTables));
    
    setMergeGuestName(uniqueGuests.join(' & '));
    setMergeTableNumber(uniqueTables.join(', '));
    setMergePaymentMethod(orderA.payment_method || 'online');
    setShowMergeConfirmModal(true);
  };

  const handleMergePaidOrders = async (mergedPaidOrdersList) => {
    const selectedRawOrders = getSelectedRawOrders(mergedPaidOrdersList);
    if (selectedRawOrders.length < 2) return;

    setIsMerging(true);
    try {
      const sorted = [...selectedRawOrders].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      const primaryOrder = sorted[0];
      const otherOrders = sorted.slice(1);
      const otherIds = otherOrders.map(o => o.id);

      const mergedItems = JSON.parse(JSON.stringify(primaryOrder.items || []));
      
      otherOrders.forEach(order => {
        const items = order.items || [];
        items.forEach(newItem => {
          const existingItem = mergedItems.find(item => item.id === newItem.id);
          if (existingItem) {
            existingItem.quantity += newItem.quantity;
          } else {
            mergedItems.push({ ...newItem });
          }
        });
      });

      const totalRevenue = selectedRawOrders.reduce((sum, o) => sum + (o.total || 0), 0);

      const uniqueOrderNos = Array.from(new Set(
        selectedRawOrders.map(o => o.order_no).filter(Boolean)
      ));
      const mergedOrderNo = uniqueOrderNos.join(', ');

      const { error: updateError } = await supabase
        .from('orders')
        .update({
          guest_name: mergeGuestName,
          table_number: mergeTableNumber,
          payment_method: mergePaymentMethod,
          items: mergedItems,
          total: totalRevenue,
          order_no: mergedOrderNo,
          updated_at: new Date().toISOString()
        })
        .eq('id', primaryOrder.id);

      if (updateError) throw updateError;

      const { error: deleteError } = await supabase
        .from('orders')
        .delete()
        .in('id', otherIds);

      if (deleteError) throw deleteError;

      playChime();
      setSelectedHistoryIds([]);
      setShowMergeConfirmModal(false);
      fetchSalesHistory();
    } catch (err) {
      console.error('Error merging bills:', err);
      alert('Failed to merge bills: ' + err.message);
    } finally {
      setIsMerging(false);
    }
  };

  const updateOrderStatus = async (orderIdOrIds, nextStatus) => {
    try {
      const targetIds = Array.isArray(orderIdOrIds) ? orderIdOrIds : [orderIdOrIds];
      const { error } = await supabase
        .from('orders')
        .update({ 
          status: nextStatus,
          updated_at: new Date().toISOString()
        })
        .in('id', targetIds);

      if (error) throw error;
    } catch (err) {
      alert(`Failed to update status: ${err.message}`);
    }
  };

  const settlePaymentAndDeliver = async (order) => {
    if (!order) return;
    try {
      const targetIds = order.ids || [order.id];
      const { error } = await supabase
        .from('orders')
        .update({
          status: 'paid',
          payment_method: paymentMethod,
          updated_at: new Date().toISOString()
        })
        .in('id', targetIds);

      if (error) throw error;
      setSelectedOrderForSettle(null);
    } catch (err) {
      alert(`Failed to settle order: ${err.message}`);
    }
  };

  // Passcode verification logic
  const handleKeypadPress = (val) => {
    setAuthError('');
    if (passcodeBuffer.length >= 8) return; // limit size
    setPasscodeBuffer((prev) => prev + val);
  };

  const handleClearPasscode = () => {
    setPasscodeBuffer('');
    setAuthError('');
  };

  const handleVerifyPasscode = (e) => {
    if (e) e.preventDefault();
    if (passcodeBuffer === '718285') {
      setIsAuthenticated(true);
      setIsAdmin(true);
      localStorage.setItem('noir_dashboard_auth', 'true');
      localStorage.setItem('noir_dashboard_admin', 'true');
      setPasscodeBuffer('');
      setAuthError('');
    } else if (passcodeBuffer === STAFF_PASSCODE) {
      setIsAuthenticated(true);
      setIsAdmin(false);
      localStorage.setItem('noir_dashboard_auth', 'true');
      localStorage.removeItem('noir_dashboard_admin');
      setPasscodeBuffer('');
      setAuthError('');
    } else {
      setAuthError('Access Denied. Incorrect Speakeasy Code.');
      setPasscodeBuffer('');
    }
  };

  const handleLockOut = () => {
    setIsAuthenticated(false);
    setIsAdmin(false);
    localStorage.removeItem('noir_dashboard_auth');
    localStorage.removeItem('noir_dashboard_admin');
    setActiveView('kitchen');
  };

  const handleUnlockAdmin = (e) => {
    if (e) e.preventDefault();
    if (adminUnlockBuffer === '718285') {
      setIsAdmin(true);
      localStorage.setItem('noir_dashboard_admin', 'true');
      setShowAdminUnlockModal(false);
      setAdminUnlockBuffer('');
      setAdminUnlockError('');
      setActiveView('admin');
    } else {
      setAdminUnlockError('Incorrect Admin Passcode.');
      setAdminUnlockBuffer('');
    }
  };

  const handleAdminKeypadPress = (val) => {
    setAdminUnlockError('');
    if (adminUnlockBuffer.length >= 8) return;
    setAdminUnlockBuffer((prev) => prev + val);
  };

  const handleClearAdminPasscode = () => {
    setAdminUnlockBuffer('');
    setAdminUnlockError('');
  };

  const handleClearDatabase = async () => {
    if (clearConfirmInput !== 'CLEAR') {
      setAdminError('Please type CLEAR to confirm.');
      return;
    }
    
    setIsClearing(true);
    setAdminError('');
    try {
      if (clearConfirmType === 'paid') {
        const { error } = await supabase
          .from('orders')
          .delete()
          .eq('status', 'paid');
        if (error) throw error;
        setPaidOrders([]);
      } else {
        const { error } = await supabase
          .from('orders')
          .delete()
          .neq('id', '00000000-0000-0000-0000-000000000000');
        if (error) throw error;
        setOrders([]);
        setPaidOrders([]);
        setSelectedOrderForSettle(null);
      }
      setShowClearConfirmModal(false);
      setClearConfirmInput('');
    } catch (err) {
      console.error('Error clearing data:', err);
      setAdminError(`Database Error: ${err.message}. If this is a permission error, ensure you have enabled a DELETE RLS policy on the public.orders table in Supabase.`);
    } finally {
      setIsClearing(false);
    }
  };

  const handleDownloadPDF = () => {
    try {
      const doc = new jsPDF();
      
      // Page styling: Dark Header mimicking the elegant Noir restaurant aesthetic
      doc.setFillColor(28, 26, 23); // Deep charcoal
      doc.rect(0, 0, 210, 42, 'F');
      
      doc.setTextColor(197, 168, 128); // Gold color
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(28);
      doc.text('NOIR', 15, 22);
      
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.text('Fulfillment & Sales Ledger Report', 15, 30);
      
      doc.setTextColor(142, 117, 84); // Muted gold
      doc.text(`Generated on: ${new Date().toLocaleString()}`, 130, 30);
      
      const mergedPaid = getMergedSalesHistory(paidOrders);

      // Summary Metrics Calculations
      const totalRevenue = mergedPaid.reduce((sum, o) => {
        const { total } = getOrderBreakdown(o);
        return sum + total;
      }, 0);
      
      const totalTips = mergedPaid.reduce((sum, o) => {
        const { tipAmount } = getOrderBreakdown(o);
        return sum + tipAmount;
      }, 0);
      
      const netRevenue = totalRevenue - totalTips;
      
      const totalItemsPrepared = mergedPaid.reduce((sum, o) => {
        const { foodItems } = getOrderBreakdown(o);
        return sum + foodItems.reduce((s, i) => s + i.quantity, 0);
      }, 0);
      
      // Financial Summary Block
      doc.setTextColor(28, 26, 23);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text('FINANCIAL SUMMARY', 15, 52);
      
      doc.setDrawColor(197, 168, 128);
      doc.setLineWidth(0.5);
      doc.line(15, 55, 195, 55);
      
      autoTable(doc, {
        startY: 58,
        theme: 'plain',
        styles: { fontSize: 10, cellPadding: 4, textColor: [44, 40, 35] },
        body: [
          ['Total Completed Sales:', `${mergedPaid.length} Transactions`, 'Active Pending Orders:', `${orders.length} Orders`],
          ['Gross Revenue (incl. Tips):', `$${totalRevenue.toFixed(2)}`, 'Tips Collected:', `$${totalTips.toFixed(2)}`],
          ['Net Product Revenue:', `$${netRevenue.toFixed(2)}`, 'Total Items Sold:', `${totalItemsPrepared} items`]
        ],
        columnStyles: {
          0: { fontStyle: 'bold', width: 50 },
          1: { width: 45 },
          2: { fontStyle: 'bold', width: 45 },
          3: { width: 45 }
        }
      });
      
      // Detailed Ledger Table Header
      const nextY = doc.lastAutoTable.finalY + 12;
      doc.text('DETAILED TRANSACTION LEDGER', 15, nextY);
      doc.line(15, nextY + 3, 195, nextY + 3);
      
      // Prepare table data
      const tableRows = mergedPaid.map((order) => {
        const { foodItems, tipAmount, total } = getOrderBreakdown(order);
        const dateStr = new Date(order.updated_at).toLocaleDateString();
        const timeStr = new Date(order.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        const itemsStr = foodItems
          .map((item) => `${item.quantity}x ${item.name}`)
          .join(', ');
          
        const orderNos = order.order_nos && order.order_nos.length > 0 
          ? order.order_nos.join(', ') 
          : (order.order_no || 'N/A');

        return [
          `${dateStr} ${timeStr}`,
          orderNos,
          `Table ${order.table_number}`,
          order.guest_name,
          itemsStr,
          `$${tipAmount.toFixed(2)}`,
          `$${total.toFixed(2)}`,
          order.payment_method === 'cash' ? 'Cash' : 'Card'
        ];
      });
      
      autoTable(doc, {
        startY: nextY + 6,
        head: [['Time', 'Order #', 'Table', 'Guest', 'Items', 'Tip', 'Total', 'Payment']],
        body: tableRows,
        theme: 'striped',
        headStyles: { fillColor: [28, 26, 23], textColor: [197, 168, 128], fontSize: 9 },
        bodyStyles: { fontSize: 8, textColor: [28, 26, 23] },
        columnStyles: {
          0: { cellWidth: 28 },
          1: { cellWidth: 15 },
          2: { cellWidth: 15 },
          3: { cellWidth: 20 },
          4: { cellWidth: 62 },
          5: { cellWidth: 15 },
          6: { cellWidth: 15 },
          7: { cellWidth: 15 }
        }
      });
      
      doc.save(`noir_sales_report_${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (err) {
      console.error('Failed to generate PDF:', err);
      alert('Failed to generate PDF. Check console for details.');
    }
  };

  const handleDownloadBill = (order) => {
    if (!order) return;
    try {
      const doc = new jsPDF({
        unit: 'mm',
        format: 'a6' // 105mm x 148mm
      });
      
      const { foodItems, subtotal, tipAmount, total } = getOrderBreakdown(order);
      
      // Header
      doc.setFillColor(28, 26, 23); // Charcoal
      doc.rect(0, 0, 105, 22, 'F');
      
      doc.setTextColor(197, 168, 128); // Gold
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text('NOIR', 52.5, 9, { align: 'center' });
      
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      doc.text('ELEGANT QR ORDERING', 52.5, 14, { align: 'center' });
      
      // Receipt Body Title
      doc.setTextColor(28, 26, 23);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text('GUEST BILL & RECEIPT', 52.5, 30, { align: 'center' });
      
      doc.setDrawColor(197, 168, 128);
      doc.setLineWidth(0.3);
      doc.line(10, 33, 95, 33);
      
      // Info section
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(80, 80, 80);
      
      const orderNos = order.order_nos ? order.order_nos.join(', ') : (order.order_no || 'N/A');
      doc.text(`Table: Table ${order.table_number}`, 10, 39);
      doc.text(`Guest: ${order.guest_name}`, 10, 43);
      doc.text(`Order No(s): ${orderNos}`, 10, 47);
      
      const dateStr = new Date(order.created_at).toLocaleDateString();
      const timeStr = new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      doc.text(`Date: ${dateStr} ${timeStr}`, 10, 51);
      
      doc.line(10, 55, 95, 55);
      
      // Items list table
      const itemRows = foodItems.map(item => [
        `${item.quantity}x`,
        item.name,
        `$${(item.price * item.quantity).toFixed(2)}`
      ]);
      
      autoTable(doc, {
        startY: 57,
        margin: { left: 10, right: 10 },
        head: [['Qty', 'Item Description', 'Amount']],
        body: itemRows,
        theme: 'plain',
        headStyles: { fillColor: [245, 239, 235], textColor: [28, 26, 23], fontSize: 7, fontStyle: 'bold' },
        bodyStyles: { fontSize: 7, textColor: [28, 26, 23] },
        columnStyles: {
          0: { cellWidth: 10 },
          1: { cellWidth: 55 },
          2: { cellWidth: 20, halign: 'right' }
        },
        styles: { cellPadding: 1.5 }
      });
      
      // Totals section
      const totalsY = doc.lastAutoTable.finalY + 4;
      doc.setDrawColor(197, 168, 128);
      doc.line(10, totalsY, 95, totalsY);
      
      doc.setFontSize(7.5);
      doc.setTextColor(28, 26, 23);
      
      doc.setFont('helvetica', 'normal');
      doc.text('Subtotal:', 55, totalsY + 4, { align: 'right' });
      doc.text(`$${subtotal.toFixed(2)}`, 95, totalsY + 4, { align: 'right' });
      
      doc.text('Gratuity/Tip:', 55, totalsY + 8, { align: 'right' });
      doc.text(`$${tipAmount.toFixed(2)}`, 95, totalsY + 8, { align: 'right' });
      
      doc.setFont('helvetica', 'bold');
      doc.text('Grand Total:', 55, totalsY + 13, { align: 'right' });
      doc.text(`$${total.toFixed(2)}`, 95, totalsY + 13, { align: 'right' });
      
      // Footer
      const footerY = totalsY + 20;
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(6.5);
      doc.setTextColor(140, 140, 140);
      doc.text('Thank you for dining with us!', 52.5, footerY, { align: 'center' });
      doc.text('NOIR - ELEGANT DINING EXPERIENCE', 52.5, footerY + 3, { align: 'center' });
      
      doc.save(`noir_bill_table_${order.table_number}_${new Date().toISOString().slice(0,10)}.pdf`);
    } catch (err) {
      console.error('Error downloading bill:', err);
      alert('Error downloading bill: ' + err.message);
    }
  };

  const handlePrintBill = (order) => {
    if (!order) return;
    try {
      const doc = new jsPDF({
        unit: 'mm',
        format: 'a6' // 105mm x 148mm
      });
      
      const { foodItems, subtotal, tipAmount, total } = getOrderBreakdown(order);
      
      // Header
      doc.setFillColor(28, 26, 23); // Charcoal
      doc.rect(0, 0, 105, 22, 'F');
      
      doc.setTextColor(197, 168, 128); // Gold
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text('NOIR', 52.5, 9, { align: 'center' });
      
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      doc.text('ELEGANT QR ORDERING', 52.5, 14, { align: 'center' });
      
      // Receipt Body Title
      doc.setTextColor(28, 26, 23);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text('GUEST BILL & RECEIPT', 52.5, 30, { align: 'center' });
      
      doc.setDrawColor(197, 168, 128);
      doc.setLineWidth(0.3);
      doc.line(10, 33, 95, 33);
      
      // Info section
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(80, 80, 80);
      
      const orderNos = order.order_nos ? order.order_nos.join(', ') : (order.order_no || 'N/A');
      doc.text(`Table: Table ${order.table_number}`, 10, 39);
      doc.text(`Guest: ${order.guest_name}`, 10, 43);
      doc.text(`Order No(s): ${orderNos}`, 10, 47);
      
      const dateStr = new Date(order.created_at).toLocaleDateString();
      const timeStr = new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      doc.text(`Date: ${dateStr} ${timeStr}`, 10, 51);
      
      doc.line(10, 55, 95, 55);
      
      // Items list table
      const itemRows = foodItems.map(item => [
        `${item.quantity}x`,
        item.name,
        `$${(item.price * item.quantity).toFixed(2)}`
      ]);
      
      autoTable(doc, {
        startY: 57,
        margin: { left: 10, right: 10 },
        head: [['Qty', 'Item Description', 'Amount']],
        body: itemRows,
        theme: 'plain',
        headStyles: { fillColor: [245, 239, 235], textColor: [28, 26, 23], fontSize: 7, fontStyle: 'bold' },
        bodyStyles: { fontSize: 7, textColor: [28, 26, 23] },
        columnStyles: {
          0: { cellWidth: 10 },
          1: { cellWidth: 55 },
          2: { cellWidth: 20, halign: 'right' }
        },
        styles: { cellPadding: 1.5 }
      });
      
      // Totals section
      const totalsY = doc.lastAutoTable.finalY + 4;
      doc.setDrawColor(197, 168, 128);
      doc.line(10, totalsY, 95, totalsY);
      
      doc.setFontSize(7.5);
      doc.setTextColor(28, 26, 23);
      
      doc.setFont('helvetica', 'normal');
      doc.text('Subtotal:', 55, totalsY + 4, { align: 'right' });
      doc.text(`$${subtotal.toFixed(2)}`, 95, totalsY + 4, { align: 'right' });
      
      doc.text('Gratuity/Tip:', 55, totalsY + 8, { align: 'right' });
      doc.text(`$${tipAmount.toFixed(2)}`, 95, totalsY + 8, { align: 'right' });
      
      doc.setFont('helvetica', 'bold');
      doc.text('Grand Total:', 55, totalsY + 13, { align: 'right' });
      doc.text(`$${total.toFixed(2)}`, 95, totalsY + 13, { align: 'right' });
      
      // Footer
      const footerY = totalsY + 20;
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(6.5);
      doc.setTextColor(140, 140, 140);
      doc.text('Thank you for dining with us!', 52.5, footerY, { align: 'center' });
      doc.text('NOIR - ELEGANT DINING EXPERIENCE', 52.5, footerY + 3, { align: 'center' });
      
      // Generate blob URL for print
      const pdfUrl = doc.output('bloburl');
      
      // Print using a hidden iframe
      const printFrame = document.createElement('iframe');
      printFrame.style.position = 'fixed';
      printFrame.style.right = '0';
      printFrame.style.bottom = '0';
      printFrame.style.width = '0';
      printFrame.style.height = '0';
      printFrame.style.border = '0';
      printFrame.src = pdfUrl;
      
      document.body.appendChild(printFrame);
      
      printFrame.onload = () => {
        printFrame.contentWindow.focus();
        printFrame.contentWindow.print();
        setTimeout(() => {
          document.body.removeChild(printFrame);
        }, 1000);
      };
      
    } catch (err) {
      console.error('Error printing bill:', err);
      alert('Error printing bill: ' + err.message);
    }
  };

  // Math aggregates for Sales Tab
  const totalFulfillCount = paidOrders.length;
  
  const totalRevenue = paidOrders.reduce((sum, o) => {
    const { total } = getOrderBreakdown(o);
    return sum + total;
  }, 0);

  const totalTips = paidOrders.reduce((sum, o) => {
    const { tipAmount } = getOrderBreakdown(o);
    return sum + tipAmount;
  }, 0);

  // Sorting columns
  const newOrders = orders.filter((o) => o.status === 'new');
  const preparingOrders = orders.filter((o) => o.status === 'preparing');
  const readyOrders = orders.filter((o) => o.status === 'ready');

  // Render Lock Screen if not authorized
  if (!isAuthenticated) {
    return (
      <div className="lock-screen-container">
        <div className="lock-card">
          <div className="lock-logo">Noir</div>
          <div className="lock-subtitle">Staff speakeasy vault lock</div>
          
          <form onSubmit={handleVerifyPasscode}>
            {/* Visual feedback dots */}
            <div className="passcode-dots-row">
              {[...Array(6)].map((_, i) => (
                <div
                  key={i}
                  className={`passcode-dot ${i < passcodeBuffer.length ? 'filled' : ''}`}
                ></div>
              ))}
            </div>

            {/* Speakeasy Layout Keypad */}
            <div className="keypad-grid">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
                <button
                  key={num}
                  type="button"
                  className="keypad-btn"
                  onClick={() => handleKeypadPress(num)}
                >
                  {num}
                </button>
              ))}
              <button
                type="button"
                className="keypad-btn action"
                style={{ color: '#F44336', borderColor: 'rgba(244,67,54,0.3)' }}
                onClick={handleClearPasscode}
              >
                Clear
              </button>
              <button
                type="button"
                className="keypad-btn"
                onClick={() => handleKeypadPress('0')}
              >
                0
              </button>
              <button
                type="submit"
                className="keypad-btn action"
                style={{ color: 'var(--accent-cyan)', borderColor: 'rgba(0,191,165,0.3)' }}
              >
                Enter
              </button>
            </div>

            {authError && <div className="lock-err-msg">{authError}</div>}
          </form>
        </div>
      </div>
    );
  }

  // Render Dashboard Workspace
  return (
    <>
      {/* Dashboard Top Header */}
      <header className="dashboard-header">
        <div className="dashboard-brand">
          <span className="brand-logo">Noir</span>
          <span className="panel-title">Fulfillment Panel</span>
        </div>

        <nav className="dashboard-nav">
          <button
            className={`nav-tab ${activeView === 'kitchen' ? 'active' : ''}`}
            onClick={() => {
              setActiveView('kitchen');
              setSelectedOrderForSettle(null);
            }}
          >
            🍳 Kitchen Board
          </button>
          <button
            className={`nav-tab ${activeView === 'floor' ? 'active' : ''}`}
            onClick={() => {
              setActiveView('floor');
              setSelectedOrderForSettle(null);
            }}
          >
            🏃 Waiter / Floor
          </button>
          <button
            className={`nav-tab ${activeView === 'history' ? 'active' : ''}`}
            onClick={() => {
              setActiveView('history');
              setSelectedOrderForSettle(null);
            }}
          >
            📊 Sales History
          </button>
          {isAdmin && (
            <button
              className={`nav-tab ${activeView === 'admin' ? 'active' : ''}`}
              onClick={() => {
                setActiveView('admin');
                setSelectedOrderForSettle(null);
              }}
            >
              🔐 Admin Console
            </button>
          )}
        </nav>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div className="connection-status">
            <span className={`status-dot ${dbConnected ? '' : 'disconnected'}`}></span>
            <span>{dbConnected ? 'SYNCED' : 'OFFLINE'}</span>
          </div>
          {!isAdmin ? (
            <button 
              className="lock-out-btn admin-unlock-btn" 
              onClick={() => {
                setAdminUnlockBuffer('');
                setAdminUnlockError('');
                setShowAdminUnlockModal(true);
              }}
            >
              🔑 Unlock Admin
            </button>
          ) : (
            <span className="admin-status-badge">MANAGER MODE</span>
          )}
          <button className="lock-out-btn" onClick={handleLockOut}>
            🔐 Lock Panel
          </button>
        </div>
      </header>

      {/* Main Workspace Container */}
      <main className="dashboard-container">
        
        {/* Real-time Alert banner */}
        {newOrderAlert && activeView !== 'history' && (
          <div className="alarm-banner">
            <span className="alarm-text">
              🔔 <strong>New Order:</strong> {newOrderAlert}
            </span>
            <button className="btn-dismiss-alarm" onClick={() => setNewOrderAlert(null)}>
              Dismiss
            </button>
          </div>
        )}

        {/* 1. KITCHEN KANBAN VIEW */}
        {activeView === 'kitchen' && (() => {
            const mergedNewOrders = getMergedOrdersList(newOrders);
            const mergedPreparingOrders = getMergedOrdersList(preparingOrders);
            const mergedReadyOrders = getMergedOrdersList(readyOrders);
            
            return (
              <div className="kanban-grid">
                
                {/* COLUMN: NEW */}
                <div className="kanban-column">
                  <div className="column-header">
                    <h3 className="column-title">
                      <span className="badge-new">●</span> New Orders
                    </h3>
                    <span className="column-count">{mergedNewOrders.length}</span>
                  </div>
                  <div className="column-cards-container">
                    {mergedNewOrders.length === 0 ? (
                      <p style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', marginTop: '20px' }}>
                        No pending new orders
                      </p>
                    ) : (
                      mergedNewOrders.map((order) => {
                        const { foodItems } = getOrderBreakdown(order);
                        return (
                          <div
                            key={order.id}
                            className={`order-card ${newOrderIds.has(order.id) ? 'is-new-flash' : ''}`}
                          >
                            <div className="order-card-header">
                              <span className="order-table-label">T-{order.table_number}</span>
                              <span className="order-time">
                                {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px dashed var(--border-color)', paddingBottom: '6px' }}>
                              <span className="order-guest-name" style={{ border: 'none', padding: 0 }}>Guest: {order.guest_name}</span>
                              {order.ids.length > 1 && (
                                <span style={{ 
                                  fontSize: '10px', 
                                  backgroundColor: 'var(--accent-gold)', 
                                  color: 'var(--bg-dashboard)', 
                                  padding: '2px 6px', 
                                  borderRadius: '4px',
                                  fontWeight: 'bold' 
                                }}>
                                  Merged ({order.ids.length})
                                </span>
                              )}
                            </div>
                            
                            <div className="order-items-list" style={{ marginTop: '4px' }}>
                              {foodItems.map((item, idx) => (
                                <div key={idx} className="order-item-desc">
                                  <span>
                                    <span className="order-item-qty">{item.quantity}x</span>
                                    {item.name}
                                  </span>
                                </div>
                              ))}
                            </div>

                            <div className="order-card-pricing">
                              <span>Items: {foodItems.reduce((s, i) => s + i.quantity, 0)}</span>
                              <span className="order-total">Total: ${order.total?.toFixed(2)}</span>
                            </div>

                            <div className="order-card-actions">
                              <button
                                className="btn-card-action start-prep"
                                onClick={() => updateOrderStatus(order.ids || order.id, 'preparing')}
                              >
                                🍳 Start Prep
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* COLUMN: PREPARING */}
                <div className="kanban-column">
                  <div className="column-header">
                    <h3 className="column-title">
                      <span className="badge-preparing">●</span> Preparing
                    </h3>
                    <span className="column-count">{mergedPreparingOrders.length}</span>
                  </div>
                  <div className="column-cards-container">
                    {mergedPreparingOrders.length === 0 ? (
                      <p style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', marginTop: '20px' }}>
                        No orders being prepared
                      </p>
                    ) : (
                      mergedPreparingOrders.map((order) => {
                        const { foodItems } = getOrderBreakdown(order);
                        return (
                          <div key={order.id} className="order-card">
                            <div className="order-card-header">
                              <span className="order-table-label">T-{order.table_number}</span>
                              <span className="order-time">
                                {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px dashed var(--border-color)', paddingBottom: '6px' }}>
                              <span className="order-guest-name" style={{ border: 'none', padding: 0 }}>Guest: {order.guest_name}</span>
                              {order.ids.length > 1 && (
                                <span style={{ 
                                  fontSize: '10px', 
                                  backgroundColor: 'var(--accent-gold)', 
                                  color: 'var(--bg-dashboard)', 
                                  padding: '2px 6px', 
                                  borderRadius: '4px',
                                  fontWeight: 'bold' 
                                }}>
                                  Merged ({order.ids.length})
                                </span>
                              )}
                            </div>
                            
                            <div className="order-items-list" style={{ marginTop: '4px' }}>
                              {foodItems.map((item, idx) => (
                                <div key={idx} className="order-item-desc">
                                  <span>
                                    <span className="order-item-qty">{item.quantity}x</span>
                                    {item.name}
                                  </span>
                                </div>
                              ))}
                            </div>

                            <div className="order-card-pricing">
                              <span>Items: {foodItems.reduce((s, i) => s + i.quantity, 0)}</span>
                              <span className="order-total">Total: ${order.total?.toFixed(2)}</span>
                            </div>

                            <div className="order-card-actions">
                              <button
                                className="btn-card-action mark-ready"
                                onClick={() => updateOrderStatus(order.ids || order.id, 'ready')}
                              >
                                ✓ Mark Ready
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* COLUMN: READY */}
                <div className="kanban-column">
                  <div className="column-header">
                    <h3 className="column-title">
                      <span className="badge-ready">●</span> Ready to Deliver
                    </h3>
                    <span className="column-count">{mergedReadyOrders.length}</span>
                  </div>
                  <div className="column-cards-container">
                    {mergedReadyOrders.length === 0 ? (
                      <p style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', marginTop: '20px' }}>
                        No meals currently ready
                      </p>
                    ) : (
                      mergedReadyOrders.map((order) => {
                        const { foodItems } = getOrderBreakdown(order);
                        return (
                          <div key={order.id} className="order-card" style={{ borderColor: 'var(--status-ready-border)' }}>
                            <div className="order-card-header">
                              <span className="order-table-label">T-{order.table_number}</span>
                              <span className="order-time">
                                {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px dashed var(--border-color)', paddingBottom: '6px' }}>
                              <span className="order-guest-name" style={{ border: 'none', padding: 0 }}>Guest: {order.guest_name}</span>
                              {order.ids.length > 1 && (
                                <span style={{ 
                                  fontSize: '10px', 
                                  backgroundColor: 'var(--accent-gold)', 
                                  color: 'var(--bg-dashboard)', 
                                  padding: '2px 6px', 
                                  borderRadius: '4px',
                                  fontWeight: 'bold' 
                                }}>
                                  Merged ({order.ids.length})
                                </span>
                              )}
                            </div>
                            
                            <div className="order-items-list" style={{ marginTop: '4px' }}>
                              {foodItems.map((item, idx) => (
                                <div key={idx} className="order-item-desc">
                                  <span>
                                    <span className="order-item-qty">{item.quantity}x</span>
                                    {item.name}
                                  </span>
                                </div>
                              ))}
                            </div>

                            <div className="order-card-pricing">
                              <span>Items: {foodItems.reduce((s, i) => s + i.quantity, 0)}</span>
                              <span className="order-total">Total: ${order.total?.toFixed(2)}</span>
                            </div>

                            <p style={{ fontSize: '11px', color: 'var(--accent-cyan)', textAlign: 'center', fontWeight: '600' }}>
                              Waiting for Floor Pickup
                            </p>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

              </div>
            );
          })()}

        {/* 2. FLOOR / WAITER DELIVERY VIEW */}
        {activeView === 'floor' && (
          <div className="floor-layout">
            
            {(() => {
              const mergedReadyOrders = getMergedReadyOrders(readyOrders);
              return (
                <div className="floor-cards-column">
                  <div className="column-header">
                    <h3 className="column-title">Ready for Delivery</h3>
                    <span className="column-count">
                      {mergedReadyOrders.length} {mergedReadyOrders.length === 1 ? 'Bill' : 'Bills'} ({readyOrders.length} {readyOrders.length === 1 ? 'order' : 'orders'})
                    </span>
                  </div>

                  {mergedReadyOrders.length === 0 ? (
                    <div className="floor-empty-state">
                      <div className="floor-empty-icon">🍽️</div>
                      <p>All clear! There are no orders awaiting table delivery right now.</p>
                    </div>
                  ) : (
                    <div className="floor-grid">
                      {mergedReadyOrders.map((order) => {
                        const isSelected = selectedOrderForSettle && selectedOrderForSettle.id === order.id;
                        const { foodItems } = getOrderBreakdown(order);
                        return (
                          <div
                            key={order.id}
                            className="order-card"
                            style={{
                              borderColor: isSelected ? 'var(--accent-gold)' : 'var(--status-ready-border)',
                              cursor: 'pointer'
                            }}
                            onClick={() => setSelectedOrderForSettle(order)}
                          >
                            <div className="order-card-header">
                              <span className="order-table-label">Table {order.table_number}</span>
                              <span className="order-time">
                                {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span className="order-guest-name" style={{ border: 'none', padding: 0 }}>Guest: {order.guest_name}</span>
                              {order.ids.length > 1 && (
                                <span style={{ 
                                  fontSize: '10px', 
                                  backgroundColor: 'var(--accent-gold)', 
                                  color: 'var(--bg-dashboard)', 
                                  padding: '2px 6px', 
                                  borderRadius: '4px',
                                  fontWeight: 'bold' 
                                }}>
                                  Merged ({order.ids.length})
                                </span>
                              )}
                            </div>
                            
                            <div className="order-items-list" style={{ marginTop: '8px' }}>
                              {foodItems.map((item, idx) => (
                                <div key={idx} className="order-item-desc">
                                  <span>{item.quantity}x {item.name}</span>
                                </div>
                              ))}
                            </div>

                            <div className="order-card-pricing">
                              <span>Total to Settle:</span>
                              <span className="order-total">${order.total?.toFixed(2)}</span>
                            </div>

                            <button
                              className="btn-card-action"
                              style={{
                                backgroundColor: isSelected ? 'var(--accent-gold)' : 'var(--bg-panel)',
                                color: isSelected ? 'var(--bg-dashboard)' : 'var(--accent-gold)',
                                border: '1px solid var(--accent-gold)',
                                marginTop: '8px'
                              }}
                            >
                              {isSelected ? 'Selected' : 'Select for Settlement'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Settle Order Panel */}
            <div className="settlement-panel">
              <h2>Order Settle & Delivery</h2>
              
              {selectedOrderForSettle ? (
                <div>
                  <div className="receipt-summary">
                    <div className="receipt-summary-header">
                      <span>Table {selectedOrderForSettle.table_number}</span>
                      <span>Guest: {selectedOrderForSettle.guest_name}</span>
                    </div>
                    
                    {(() => {
                      const { foodItems, subtotal, tipAmount, total } = getOrderBreakdown(selectedOrderForSettle);
                      return (
                        <>
                          {foodItems.map((item, idx) => (
                            <div key={idx} className="receipt-summary-item">
                              <span>{item.quantity} x {item.name}</span>
                              <span>${(item.price * item.quantity).toFixed(2)}</span>
                            </div>
                          ))}

                          <div className="receipt-summary-totals">
                            <div className="calc-row">
                              <span>Subtotal:</span>
                              <span>${subtotal.toFixed(2)}</span>
                            </div>
                            <div className="calc-row">
                              <span>Gratuity:</span>
                              <span>${tipAmount.toFixed(2)}</span>
                            </div>
                            <div className="calc-row grand-total">
                              <span>Total Due:</span>
                              <span>${total.toFixed(2)}</span>
                            </div>
                          </div>
                        </>
                      );
                    })()}
                  </div>

                  <div className="payment-method-selector">
                    <span className="payment-selector-label">Method of Payment</span>
                    <div className="payment-methods-grid">
                      <button
                        type="button"
                        className={`payment-btn ${paymentMethod === 'online' ? 'active' : ''}`}
                        onClick={() => setPaymentMethod('online')}
                      >
                        💳 Online / Card
                      </button>
                      <button
                        type="button"
                        className={`payment-btn ${paymentMethod === 'cash' ? 'active' : ''}`}
                        onClick={() => setPaymentMethod('cash')}
                      >
                        💵 Cash Settle
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '12px' }}>
                    <button
                      type="button"
                      className="lock-out-btn"
                      style={{
                        padding: '14px',
                        borderColor: 'var(--accent-gold)',
                        color: 'var(--accent-gold)',
                        fontWeight: '700',
                        fontSize: '12px',
                        textTransform: 'uppercase',
                        flex: '1',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px'
                      }}
                      onClick={() => handlePrintBill(selectedOrderForSettle)}
                    >
                      🖨️ Print Bill
                    </button>
                    <button
                      className="btn-complete-settlement"
                      style={{ width: 'auto', flex: '1.5' }}
                      onClick={() => settlePaymentAndDeliver(selectedOrderForSettle)}
                    >
                      ✓ Complete & Deliver
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '40px 10px', color: 'var(--text-muted)' }}>
                  <p>Select a ready order on the left to handle payment settlement and complete delivery.</p>
                </div>
              )}
            </div>

          </div>
        )}

        {/* 3. SALES & TRANSACTION HISTORY VIEW */}
        {activeView === 'history' && (() => {
            const mergedPaidOrdersList = getMergedSalesHistory(paidOrders);
            const totalFulfillCount = mergedPaidOrdersList.length;
            
            const totalRevenue = mergedPaidOrdersList.reduce((sum, o) => {
              const { total } = getOrderBreakdown(o);
              return sum + total;
            }, 0);

            const totalTips = mergedPaidOrdersList.reduce((sum, o) => {
              const { tipAmount } = getOrderBreakdown(o);
              return sum + tipAmount;
            }, 0);

            return (
              <div className="history-layout">
                
                {/* Aggregate Dashboard Scores */}
                <div className="metrics-row">
                  <div className="metric-card">
                    <span className="metric-label">Completed Sales</span>
                    <span className="metric-value">{totalFulfillCount} Transactions</span>
                  </div>
                  <div className="metric-card">
                    <span className="metric-label">Total Revenue</span>
                    <span className="metric-value cyan">${totalRevenue.toFixed(2)}</span>
                  </div>
                  <div className="metric-card">
                    <span className="metric-label">Tips Collected</span>
                    <span className="metric-value" style={{ color: 'var(--accent-gold)' }}>
                      ${totalTips.toFixed(2)}
                    </span>
                  </div>
                </div>

                {/* List Table of transactions */}
                <div className="history-table-container">
                  <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 className="column-title">Order Ledger Logs</h3>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button 
                        type="button"
                        className="lock-out-btn" 
                        style={{ 
                          borderColor: selectedHistoryIds.length >= 2 ? 'var(--accent-gold)' : 'var(--border-color)', 
                          color: selectedHistoryIds.length >= 2 ? 'var(--accent-gold)' : 'var(--text-muted)',
                          opacity: selectedHistoryIds.length >= 2 ? 1 : 0.6,
                          fontWeight: '700'
                        }}
                        disabled={selectedHistoryIds.length < 2}
                        onClick={() => handleOpenMergeModal(mergedPaidOrdersList)}
                        title="Select 2 or more checkboxes in the table to merge"
                      >
                        🔗 Merge Selected Bills {selectedHistoryIds.length > 0 ? `(${selectedHistoryIds.length})` : ''}
                      </button>
                      <button className="lock-out-btn" onClick={fetchSalesHistory}>
                        🔄 Refresh Logs
                      </button>
                    </div>
                  </div>

                  {mergedPaidOrdersList.length === 0 ? (
                    <p style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                      No transaction records found.
                    </p>
                  ) : (
                    <table className="history-table">
                      <thead>
                        <tr>
                          <th className="checkbox-cell">
                            <input 
                              type="checkbox"
                              className="custom-checkbox"
                              checked={mergedPaidOrdersList.length > 0 && selectedHistoryIds.length === mergedPaidOrdersList.length}
                              onChange={() => handleToggleAllHistory(mergedPaidOrdersList)}
                            />
                          </th>
                          <th>Time</th>
                          <th>Order No</th>
                          <th>Guest</th>
                          <th>Table</th>
                          <th>Items Ordered</th>
                          <th>Subtotal</th>
                          <th>Tip</th>
                          <th>Total</th>
                          <th>Payment</th>
                          <th>Receipt</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mergedPaidOrdersList.map((order) => {
                          const { foodItems, subtotal, tipAmount, total } = getOrderBreakdown(order);
                          const timeStr = new Date(order.updated_at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit'
                          });
                          
                          const orderNos = order.order_nos && order.order_nos.length > 0 
                            ? order.order_nos.join(', ') 
                            : (order.order_no || 'N/A');

                          return (
                            <tr key={order.id}>
                              <td className="checkbox-cell">
                                <input 
                                  type="checkbox"
                                  className="custom-checkbox"
                                  checked={selectedHistoryIds.includes(order.id)}
                                  onChange={() => handleToggleHistorySelection(order.id)}
                                />
                              </td>
                              <td style={{ whiteSpace: 'nowrap' }}>
                                <div>{new Date(order.updated_at).toLocaleDateString()}</div>
                                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                                  {timeStr}
                                </div>
                              </td>
                              <td style={{ fontFamily: 'var(--font-mono)', fontWeight: '700', color: 'var(--accent-gold)' }}>
                                {orderNos}
                              </td>
                              <td>{order.guest_name}</td>
                              <td style={{ fontWeight: '700' }}>
                                {order.table_numbers && order.table_numbers.length > 0
                                  ? order.table_numbers.map(t => `T-${t}`).join(', ')
                                  : (order.table_number ? `T-${order.table_number}` : 'N/A')}
                              </td>
                              <td>
                                <div className="history-items-col">
                                  {foodItems.map((item, idx) => (
                                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between' }}>
                                      <span>{item.quantity}x {item.name}</span>
                                    </div>
                                  ))}
                                </div>
                              </td>
                              <td style={{ fontFamily: 'var(--font-mono)' }}>${subtotal.toFixed(2)}</td>
                              <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-gold)' }}>
                                ${tipAmount.toFixed(2)}
                              </td>
                              <td style={{ fontFamily: 'var(--font-mono)', fontWeight: '700', color: 'var(--accent-cyan)' }}>
                                ${total.toFixed(2)}
                              </td>
                              <td>
                                <span className={`payment-badge ${order.payment_method === 'cash' ? 'cash' : 'online'}`}>
                                  {order.payment_method === 'cash' ? '💵 Cash' : '💳 Card'}
                                </span>
                              </td>
                              <td>
                                <div style={{ display: 'flex', gap: '6px' }}>
                                  <button
                                    type="button"
                                    className="lock-out-btn"
                                    style={{ 
                                      padding: '4px 8px', 
                                      fontSize: '11px', 
                                      borderColor: 'var(--accent-gold)', 
                                      color: 'var(--accent-gold)',
                                      fontWeight: '700'
                                    }}
                                    onClick={() => handlePrintBill(order)}
                                  >
                                    🖨️ Print
                                  </button>
                                  <button
                                    type="button"
                                    className="lock-out-btn"
                                    style={{ 
                                      padding: '4px 8px', 
                                      fontSize: '11px', 
                                      borderColor: 'var(--border-color)', 
                                      color: 'var(--text-muted)',
                                      fontWeight: '700'
                                    }}
                                    onClick={() => handleDownloadBill(order)}
                                  >
                                    📥 PDF
                                  </button>
                                  <button
                                    type="button"
                                    className="lock-out-btn"
                                    style={{ 
                                      padding: '4px 8px', 
                                      fontSize: '11px', 
                                      borderColor: 'var(--accent-cyan)', 
                                      color: 'var(--accent-cyan)',
                                      fontWeight: '700'
                                    }}
                                    onClick={() => handleOpenEditModal(order)}
                                  >
                                    ✏️ Edit
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Floating Selection Action Bar */}
                {selectedHistoryIds.length > 0 && (
                  <div className="selection-action-bar">
                    <div className="selection-action-text">
                      <strong>{selectedHistoryIds.length}</strong> {selectedHistoryIds.length === 1 ? 'bill' : 'bills'} selected
                    </div>
                    <div className="selection-action-buttons">
                      <button
                        type="button"
                        className="lock-out-btn"
                        style={{ borderColor: 'var(--border-color)', color: 'var(--text-muted)' }}
                        onClick={() => setSelectedHistoryIds([])}
                      >
                        Deselect All
                      </button>
                      <button
                        type="button"
                        className="lock-out-btn"
                        style={{ borderColor: 'var(--accent-gold)', color: 'var(--accent-gold)' }}
                        disabled={selectedHistoryIds.length < 2}
                        onClick={() => handleOpenMergeModal(mergedPaidOrdersList)}
                      >
                        {selectedHistoryIds.length < 2 ? 'Select 2+ to Merge' : '🔗 Merge Selected'}
                      </button>
                    </div>
                  </div>
                )}

              </div>
            );
          })()}

        {/* 4. ADMIN CONSOLE VIEW */}
        {activeView === 'admin' && isAdmin && (
          <div className="admin-layout">
            <div className="admin-section-header">
              <h2 className="admin-title">Manager Vault & Operations</h2>
              <p className="admin-subtitle">Secure administrative actions for Noir Restaurant. Credentials authenticated.</p>
            </div>
            
            <div className="admin-grid-panels">
              {/* Reports Panel */}
              <div className="admin-panel-card">
                <div className="panel-card-icon">📊</div>
                <h3>Financial & Sales Reports</h3>
                <p>Compile current transaction records, total tips, products sold, and gross revenue metrics into a formatted PDF document.</p>
                <button 
                  className="admin-action-btn pdf-btn"
                  onClick={handleDownloadPDF}
                  disabled={paidOrders.length === 0}
                >
                  📥 Download PDF Ledger
                </button>
                {paidOrders.length === 0 && (
                  <span className="panel-note-warning">Note: No completed transactions in history to report.</span>
                )}
              </div>

              {/* Data Cleansing Panel */}
              <div className="admin-panel-card danger">
                <div className="panel-card-icon">⚠️</div>
                <h3>Data Management & Purge</h3>
                <p>Reset local transaction ledgers or clear standard customer queue listings to prepare for a new service shift.</p>
                
                <div className="purge-actions">
                  <button 
                    className="admin-action-btn clear-btn"
                    onClick={() => {
                      setClearConfirmType('paid');
                      setClearConfirmInput('');
                      setAdminError('');
                      setShowClearConfirmModal(true);
                    }}
                  >
                    🧹 Clear Paid Sales History
                  </button>
                  <button 
                    className="admin-action-btn clear-all-btn"
                    onClick={() => {
                      setClearConfirmType('all');
                      setClearConfirmInput('');
                      setAdminError('');
                      setShowClearConfirmModal(true);
                    }}
                  >
                    🔥 Purge All Orders (Total Reset)
                  </button>
                </div>
              </div>
            </div>

            {/* Quick Metrics Summary */}
            <div className="admin-metrics-summary">
              <div className="admin-metric-item">
                <span className="summary-label">Total Transactions Logged</span>
                <span className="summary-val">{paidOrders.length}</span>
              </div>
              <div className="admin-metric-item">
                <span className="summary-label">Active Queue Orders</span>
                <span className="summary-val">{orders.length}</span>
              </div>
              <div className="admin-metric-item">
                <span className="summary-label">Gross Revenue Pool</span>
                <span className="summary-val">${totalRevenue.toFixed(2)}</span>
              </div>
              <div className="admin-metric-item">
                <span className="summary-label">Tip Pool Share</span>
                <span className="summary-val">${totalTips.toFixed(2)}</span>
              </div>
            </div>
          </div>
        )}

      </main>

      {/* 1. ADMIN CODE UNLOCK MODAL */}
      {showAdminUnlockModal && (
        <div className="modal-overlay">
          <div className="modal-card lock-card">
            <div className="modal-close-header">
              <span className="lock-logo" style={{ fontSize: '20px', margin: 0 }}>Noir Admin</span>
              <button className="modal-close-x" onClick={() => setShowAdminUnlockModal(false)}>×</button>
            </div>
            <div className="lock-subtitle" style={{ marginBottom: '20px' }}>Enter Special Manager Passcode</div>
            
            <form onSubmit={handleUnlockAdmin}>
              <div className="passcode-dots-row" style={{ marginBottom: '20px' }}>
                {[...Array(6)].map((_, i) => (
                  <div
                    key={i}
                    className={`passcode-dot ${i < adminUnlockBuffer.length ? 'filled' : ''}`}
                  ></div>
                ))}
              </div>

              <div className="keypad-grid">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
                  <button
                    key={num}
                    type="button"
                    className="keypad-btn"
                    onClick={() => handleAdminKeypadPress(num)}
                  >
                    {num}
                  </button>
                ))}
                <button
                  type="button"
                  className="keypad-btn action"
                  style={{ color: '#F44336', borderColor: 'rgba(244,67,54,0.3)' }}
                  onClick={handleClearAdminPasscode}
                >
                  Clear
                </button>
                <button
                  type="button"
                  className="keypad-btn"
                  onClick={() => handleAdminKeypadPress('0')}
                >
                  0
                </button>
                <button
                  type="submit"
                  className="keypad-btn action"
                  style={{ color: 'var(--accent-cyan)', borderColor: 'rgba(0,191,165,0.3)' }}
                >
                  Enter
                </button>
              </div>

              {adminUnlockError && <div className="lock-err-msg">{adminUnlockError}</div>}
            </form>
          </div>
        </div>
      )}

      {/* 2. PURGE DATA CONFIRMATION MODAL */}
      {showClearConfirmModal && (
        <div className="modal-overlay">
          <div className="modal-card clear-confirm-card">
            <div className="modal-close-header">
              <h3 style={{ fontFamily: 'var(--font-title)', color: '#F44336' }}>
                ⚠️ {clearConfirmType === 'paid' ? 'Clear Sales History' : 'Purge All Database Records'}
              </h3>
              <button className="modal-close-x" onClick={() => setShowClearConfirmModal(false)}>×</button>
            </div>
            
            <div className="confirm-body">
              <p style={{ margin: '12px 0', fontSize: '13px', color: 'var(--text-muted)' }}>
                {clearConfirmType === 'paid' 
                  ? 'This will delete all completed (paid) orders from the database. Active new, preparing, or ready orders will remain unaffected.' 
                  : 'WARNING: This will permanently delete ALL orders (active and completed) from the database. This action is irreversible.'}
              </p>
              
              <p style={{ fontWeight: '700', fontSize: '12px', color: 'var(--text-main)', marginBottom: '8px' }}>
                Type <span style={{ color: '#F44336', fontFamily: 'var(--font-mono)' }}>CLEAR</span> below to authorize:
              </p>
              
              <input
                type="text"
                className="confirm-input-field"
                placeholder="Type CLEAR here"
                value={clearConfirmInput}
                onChange={(e) => setClearConfirmInput(e.target.value)}
                disabled={isClearing}
              />

              {adminError && <div className="confirm-error-msg">{adminError}</div>}
              
              <div className="confirm-modal-actions">
                <button 
                  className="confirm-cancel-btn" 
                  onClick={() => setShowClearConfirmModal(false)}
                  disabled={isClearing}
                >
                  Cancel
                </button>
                <button 
                  className="confirm-delete-btn"
                  onClick={handleClearDatabase}
                  disabled={clearConfirmInput !== 'CLEAR' || isClearing}
                >
                  {isClearing ? 'Clearing...' : 'Confirm Purge'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. EDIT SINGLE COMPLETED BILL MODAL */}
      {editingOrder && (
        <div className="modal-overlay">
          <div className="modal-card" style={{ maxWidth: '450px', width: '90%' }}>
            <div className="modal-close-header">
              <h3 style={{ fontFamily: 'var(--font-title)', color: 'var(--accent-cyan)', margin: 0 }}>
                ✏️ Edit Completed Bill
              </h3>
              <button className="modal-close-x" onClick={() => setEditingOrder(null)}>×</button>
            </div>
            
            <div style={{ marginBottom: '16px', fontSize: '12px', color: 'var(--text-muted)', textAlign: 'left' }}>
              Order No(s): <strong style={{ color: 'var(--accent-gold)' }}>
                {editingOrder.order_nos ? editingOrder.order_nos.join(', ') : (editingOrder.order_no || 'N/A')}
              </strong>
            </div>

            <div className="form-group">
              <label className="form-label">Guest Name</label>
              <input
                type="text"
                className="form-input"
                value={editGuestName}
                onChange={(e) => setEditGuestName(e.target.value)}
                disabled={isSavingEdit}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Table Assignment</label>
              <input
                type="text"
                className="form-input"
                value={editTableNumber}
                onChange={(e) => setEditTableNumber(e.target.value)}
                disabled={isSavingEdit}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Payment Method</label>
              <select
                className="form-select"
                value={editPaymentMethod}
                onChange={(e) => setEditPaymentMethod(e.target.value)}
                disabled={isSavingEdit}
              >
                <option value="online">💳 Card / Online</option>
                <option value="cash">💵 Cash</option>
              </select>
            </div>

            {(() => {
              const mergedPaidOrdersList = getMergedSalesHistory(paidOrders);
              const otherCompletedGroups = mergedPaidOrdersList.filter(g => g.id !== editingOrder.id);
              return (
                <div style={{ borderTop: '1px solid var(--border-color)', marginTop: '20px', paddingTop: '16px' }}>
                  <label className="form-label" style={{ color: 'var(--accent-gold)', marginBottom: '8px', display: 'block' }}>
                    🔗 Merge this bill with another completed bill
                  </label>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <select
                      className="form-select"
                      value={mergeTargetGroupId}
                      onChange={(e) => setMergeTargetGroupId(e.target.value)}
                      style={{ flex: 1 }}
                    >
                      <option value="">-- Select Bill to Merge --</option>
                      {otherCompletedGroups.map(group => {
                        const timeStr = new Date(group.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        return (
                          <option key={group.id} value={group.id}>
                            {group.guest_name} (T-{group.table_number}) - ${group.total.toFixed(2)} - {timeStr}
                          </option>
                        );
                      })}
                    </select>
                    <button
                      type="button"
                      className="lock-out-btn"
                      style={{ borderColor: 'var(--accent-gold)', color: 'var(--accent-gold)', whiteSpace: 'nowrap', padding: '10px 14px' }}
                      disabled={!mergeTargetGroupId}
                      onClick={() => {
                        const targetGroup = otherCompletedGroups.find(g => g.id === mergeTargetGroupId);
                        if (targetGroup) {
                          setSelectedHistoryIds([editingOrder.id, targetGroup.id]);
                          setEditingOrder(null);
                          handleOpenMergeModalForTwo(editingOrder, targetGroup);
                        }
                      }}
                    >
                      Merge
                    </button>
                  </div>
                </div>
              );
            })()}

            <div className="confirm-modal-actions">
              <button 
                className="confirm-cancel-btn" 
                onClick={() => setEditingOrder(null)}
                disabled={isSavingEdit}
              >
                Cancel
              </button>
              <button 
                className="lock-out-btn"
                style={{ 
                  flex: 1, 
                  borderColor: 'var(--accent-cyan)', 
                  color: 'var(--accent-cyan)',
                  padding: '12px',
                  borderRadius: '4px',
                  fontWeight: '700',
                  fontSize: '12px'
                }}
                onClick={handleSaveEdit}
                disabled={!editGuestName.trim() || isSavingEdit}
              >
                {isSavingEdit ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. MERGE COMPLETED BILLS MODAL */}
      {showMergeConfirmModal && (
        <div className="modal-overlay">
          <div className="modal-card" style={{ maxWidth: '500px', width: '90%' }}>
            <div className="modal-close-header">
              <h3 style={{ fontFamily: 'var(--font-title)', color: 'var(--accent-gold)', margin: 0 }}>
                🔗 Merge Completed Bills
              </h3>
              <button className="modal-close-x" onClick={() => setShowMergeConfirmModal(false)}>×</button>
            </div>

            {(() => {
              const mergedPaidOrdersList = getMergedSalesHistory(paidOrders);
              const selectedRawOrders = getSelectedRawOrders(mergedPaidOrdersList);
              const totalAmount = selectedRawOrders.reduce((sum, o) => sum + (o.total || 0), 0);
              
              const mergedItemsList = [];
              selectedRawOrders.forEach(order => {
                (order.items || []).forEach(newItem => {
                  if (newItem.id !== 'tip' && !newItem.name?.includes('Tip')) {
                    const existing = mergedItemsList.find(i => i.id === newItem.id);
                    if (existing) {
                      existing.quantity += newItem.quantity;
                    } else {
                      mergedItemsList.push({ ...newItem });
                    }
                  }
                });
              });

              return (
                <div>
                  <div className="modal-info-title">Bills Being Merged ({selectedRawOrders.length})</div>
                  <div className="modal-info-box">
                    {selectedRawOrders.map((order, idx) => (
                      <div key={order.id || idx} className="modal-info-item">
                        <span>
                          {order.order_no || 'N/A'} - {order.guest_name} (T-{order.table_number})
                        </span>
                        <span style={{ fontWeight: '700', color: 'var(--accent-cyan)' }}>
                          ${(order.total || 0).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="modal-info-title">Merged Items Preview</div>
                  <div className="modal-info-box" style={{ maxHeight: '120px' }}>
                    {mergedItemsList.map((item, idx) => (
                      <div key={item.id || idx} className="modal-info-item">
                        <span>{item.name}</span>
                        <span>{item.quantity}x</span>
                      </div>
                    ))}
                    <div className="modal-info-item" style={{ borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: '6px', paddingTop: '6px', fontWeight: '700' }}>
                      <span>Combined Total Bill:</span>
                      <span style={{ color: 'var(--accent-gold)' }}>${totalAmount.toFixed(2)}</span>
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Final Guest Name</label>
                    <input
                      type="text"
                      className="form-input"
                      value={mergeGuestName}
                      onChange={(e) => setMergeGuestName(e.target.value)}
                      disabled={isMerging}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Final Table Assignment</label>
                    <input
                      type="text"
                      className="form-input"
                      value={mergeTableNumber}
                      onChange={(e) => setMergeTableNumber(e.target.value)}
                      disabled={isMerging}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Payment Method</label>
                    <select
                      className="form-select"
                      value={mergePaymentMethod}
                      onChange={(e) => setMergePaymentMethod(e.target.value)}
                      disabled={isMerging}
                    >
                      <option value="online">💳 Card / Online</option>
                      <option value="cash">💵 Cash</option>
                    </select>
                  </div>

                  <div className="confirm-modal-actions">
                    <button 
                      className="confirm-cancel-btn" 
                      onClick={() => setShowMergeConfirmModal(false)}
                      disabled={isMerging}
                    >
                      Cancel
                    </button>
                    <button 
                      className="lock-out-btn"
                      style={{ 
                        flex: 1, 
                        borderColor: 'var(--accent-gold)', 
                        color: 'var(--accent-gold)',
                        padding: '12px',
                        borderRadius: '4px',
                        fontWeight: '700',
                        fontSize: '12px'
                      }}
                      onClick={() => handleMergePaidOrders(mergedPaidOrdersList)}
                      disabled={!mergeGuestName.trim() || isMerging}
                    >
                      {isMerging ? 'Merging...' : 'Confirm & Merge'}
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </>
  );
}

export default App;
