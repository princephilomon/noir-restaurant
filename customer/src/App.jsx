import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import './App.css';

// Noir Exact Menu Items
const MENU_ITEMS = [
  // Appetizers
  { id: 'app-octopus', name: 'Grilled Octopus', price: 16.00, desc: 'W/ Baby arugula, mixed peppers, onions and cherry tomatoes', category: 'Appetizers', tags: [] },
  { id: 'app-calamari', name: 'Crispy Calamari', price: 12.00, desc: 'W/ Marinara and Jalapeño Sauce', category: 'Appetizers', tags: [] },
  { id: 'app-mofongo-chicken', name: 'Mini Mofongo (Chicken)', price: 12.00, desc: 'Savory mashed plantains with chicken', category: 'Appetizers', tags: [] },
  { id: 'app-mofongo-steak', name: 'Mini Mofongo (Steak)', price: 14.00, desc: 'Savory mashed plantains with steak', category: 'Appetizers', tags: [] },
  { id: 'app-mofongo-shrimp', name: 'Mini Mofongo (Shrimp)', price: 16.00, desc: 'Savory mashed plantains with shrimp', category: 'Appetizers', tags: [] },
  { id: 'app-mac-cheese', name: 'Baked Mac & Cheese', price: 12.00, desc: 'With Parmesan cheese', category: 'Appetizers', tags: ['Veg'] },
  { id: 'app-lobster-mac', name: 'Lobster Mac & Cheese', price: 14.00, desc: 'With fresh lobster and Parmesan cheese', category: 'Appetizers', tags: [] },
  { id: 'app-wings', name: 'Fried Chicken Wings', price: 12.00, desc: 'Choice of Sauce: Buffalo | BBQ | Habanero Sweet Chili', category: 'Appetizers', tags: [] },
  { id: 'app-tenders', name: 'Chicken Tenders', price: 13.00, desc: 'Crispy golden fried chicken tenders', category: 'Appetizers', tags: [] },
  { id: 'app-tenders-fries', name: 'Chicken Tenders w/ French Fries', price: 17.00, desc: 'Served with crispy French fries', category: 'Appetizers', tags: [] },
  { id: 'app-tacos', name: 'Tacos (3 Pcs)', price: 12.00, desc: 'Three tacos with choice of Beef or Steak', category: 'Appetizers', tags: [] },
  { id: 'app-guac-chips', name: 'Guacamole & Chips', price: 10.00, desc: 'House-made fresh guacamole with crispy tortilla chips', category: 'Appetizers', tags: ['Veg', 'Gluten-Free'] },

  // Salads
  { id: 'sal-caesar', name: 'Caesar Salad (Plain)', price: 12.00, desc: 'Classic Caesar salad with shaved parmesan and croutons', category: 'Salads', tags: ['Veg'] },
  { id: 'sal-caesar-chicken', name: 'Caesar Salad with Chicken', price: 14.00, desc: 'Classic Caesar salad topped with grilled chicken', category: 'Salads', tags: [] },
  { id: 'sal-caesar-steak', name: 'Caesar Salad with Steak', price: 16.00, desc: 'Classic Caesar salad topped with sliced steak', category: 'Salads', tags: [] },
  { id: 'sal-caesar-shrimp', name: 'Caesar Salad with Shrimp', price: 18.00, desc: 'Classic Caesar salad topped with grilled shrimp', category: 'Salads', tags: [] },
  { id: 'sal-greek', name: 'Greek Salad (Plain)', price: 10.00, desc: 'Traditional Greek salad with cucumbers, tomatoes, olives, and feta', category: 'Salads', tags: ['Veg', 'Gluten-Free'] },
  { id: 'sal-greek-chicken', name: 'Greek Salad with Chicken', price: 14.00, desc: 'Greek salad topped with grilled chicken', category: 'Salads', tags: [] },
  { id: 'sal-greek-steak', name: 'Greek Salad with Steak', price: 16.00, desc: 'Greek salad topped with sliced steak', category: 'Salads', tags: [] },

  // Main Course
  { id: 'mc-skirt-steak', name: 'Skirt Steak', price: 35.00, desc: 'Churrasco. With Choice of Side', category: 'Main Course', tags: [] },
  { id: 'mc-cheeseburger', name: 'Cheeseburger', price: 19.00, desc: 'Served with French Fries', category: 'Main Course', tags: [] },
  { id: 'mc-penne-vodka', name: 'Penne A La Vodka (Plain)', price: 14.00, desc: 'Penne pasta in creamy tomato vodka sauce', category: 'Main Course', tags: ['Veg'] },
  { id: 'mc-penne-chicken', name: 'Penne A La Vodka with Chicken', price: 20.00, desc: 'Penne pasta with chicken in vodka sauce', category: 'Main Course', tags: [] },
  { id: 'mc-penne-shrimp', name: 'Penne A La Vodka with Shrimp', price: 21.00, desc: 'Penne pasta with shrimp in vodka sauce', category: 'Main Course', tags: [] },
  { id: 'mc-red-snapper', name: 'Red Snapper', price: 30.00, desc: 'With Your Choice of Side', category: 'Main Course', tags: [] },
  { id: 'mc-chicken-breast', name: 'Grilled Chicken Breast', price: 22.00, desc: 'With Your Choice of Side', category: 'Main Course', tags: ['Gluten-Free'] },
  { id: 'mc-ribeye', name: 'Ribeye Steak', price: 35.00, desc: 'Your Choice of Sides', category: 'Main Course', tags: [] },

  // Hibachi Mains & Combinations
  { id: 'hib-veg', name: 'Hibachi Vegetables', price: 15.00, desc: 'Stir-fried seasonal vegetables', category: 'Hibachi', tags: ['Veg'] },
  { id: 'hib-shrimp-scallop', name: 'Hibachi Shrimp or Scallop', price: 15.00, desc: 'Sautéed shrimp or sea scallops', category: 'Hibachi', tags: [] },
  { id: 'hib-lobster', name: 'Hibachi Lobster Tail', price: 15.00, desc: 'Premium cold water lobster tail', category: 'Hibachi', tags: [] },
  { id: 'hib-chicken-comb', name: 'Hibachi Chicken Combo', price: 30.00, desc: 'Comes with Rice, Noodles and Vegetables', category: 'Hibachi', tags: [] },
  { id: 'hib-filet-comb', name: 'Hibachi Filet Mignon Combo', price: 35.00, desc: 'Comes with Rice, Noodles and Vegetables', category: 'Hibachi', tags: [] },
  { id: 'hib-surf-comb', name: 'Hibachi Surf & Turf Combo', price: 45.00, desc: 'Comes with Rice, Noodles and Vegetables', category: 'Hibachi', tags: [] },
  { id: 'hib-salmon-comb', name: 'Hibachi Salmon Combo', price: 35.00, desc: 'Comes with Rice, Noodles and Vegetables', category: 'Hibachi', tags: [] },

  // Side Orders
  { id: 'side-rice', name: 'Fried Rice', price: 7.00, desc: 'Classic seasoned wok fried rice', category: 'Sides', tags: ['Veg'] },
  { id: 'side-fries', name: 'French Fries', price: 7.00, desc: 'Crispy salted golden french fries', category: 'Sides', tags: ['Veg'] },
  { id: 'side-yuca', name: 'Yuca Fries', price: 7.00, desc: 'Crispy thick-cut yuca root fries', category: 'Sides', tags: ['Veg'] },
  { id: 'side-tostones', name: 'Tostones', price: 7.00, desc: 'Twice-fried crispy green plantain slices', category: 'Sides', tags: ['Veg', 'Gluten-Free'] },
  { id: 'side-noodles', name: 'Noodles', price: 10.00, desc: 'Sautéed seasoned lo-mein style noodles', category: 'Sides', tags: ['Veg'] },
  { id: 'side-mash', name: 'Mash Potatoes', price: 7.00, desc: 'Creamy garlic whipped potatoes', category: 'Sides', tags: ['Veg'] },

  // Sushi
  { id: 'sushi-campesino', name: 'Campesino Rolls', price: 14.00, desc: 'Specialty rolls with Dominican flair', category: 'Sushi', tags: [] },
  { id: 'sushi-shrimp-temp', name: 'Shrimp Tempura Roll', price: 18.00, desc: 'Crispy fried shrimp, cucumber, avocado', category: 'Sushi', tags: [] },
  { id: 'sushi-chicken-temp', name: 'Chicken Tempura Roll', price: 14.00, desc: 'Crispy tempura chicken roll', category: 'Sushi', tags: [] },

  // Happy Hour
  { id: 'hh-tacos', name: 'Happy Hour Tacos', price: 8.00, desc: 'Special happy hour price (From 5PM till 8PM)', category: 'Happy Hour', tags: [] },
  { id: 'hh-wings', name: 'Happy Hour Chicken Wings', price: 8.00, desc: 'Special happy hour price (From 5PM till 8PM)', category: 'Happy Hour', tags: [] },
  { id: 'hh-calamari', name: 'Happy Hour Fried Calamari', price: 8.00, desc: 'Special happy hour price (From 5PM till 8PM)', category: 'Happy Hour', tags: [] },
  { id: 'hh-mofonguitos', name: 'Happy Hour Mofonguitos', price: 8.00, desc: 'Special happy hour price (From 5PM till 8PM)', category: 'Happy Hour', tags: [] },
  { id: 'hh-tenders', name: 'Happy Hour Chicken Tenders', price: 8.00, desc: 'Special happy hour price (From 5PM till 8PM)', category: 'Happy Hour', tags: [] }
];

const CATEGORIES = ['All', 'Appetizers', 'Salads', 'Main Course', 'Hibachi', 'Sushi', 'Sides', 'Happy Hour'];

function App() {
  const [theme, setTheme] = useState('warm');
  const [activeCategory, setActiveCategory] = useState('All');
  const [cart, setCart] = useState({});
  const [isCartOpen, setIsCartOpen] = useState(false);
  
  // Welcome page and table confirm
  const [isWelcomeScreen, setIsWelcomeScreen] = useState(true);
  const [tableNumber, setTableNumber] = useState('');
  const [customerName, setCustomerName] = useState('');
  
  // Tipping (defaulting to 'none' / zero tip first, letting customer choose)
  const [tipType, setTipType] = useState('none');
  const [customTip, setCustomTip] = useState('');
  
  // Submission
  const [orderState, setOrderState] = useState('idle');
  const [errorMessage, setErrorMessage] = useState('');

  // Extract table number from URL on load
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const table = urlParams.get('table') || urlParams.get('t');
    if (table) {
      setTableNumber(table);
    }
  }, []);

  // Update body class when theme changes
  useEffect(() => {
    if (theme === 'teal') {
      document.body.classList.add('theme-teal');
    } else {
      document.body.classList.remove('theme-teal');
    }
  }, [theme]);

  // Cart operations
  const addToCart = (item) => {
    setCart((prev) => {
      const existing = prev[item.id];
      return {
        ...prev,
        [item.id]: {
          item,
          quantity: existing ? existing.quantity + 1 : 1
        }
      };
    });
  };

  const removeFromCart = (itemId) => {
    setCart((prev) => {
      const existing = prev[itemId];
      if (!existing) return prev;
      
      const newCart = { ...prev };
      if (existing.quantity <= 1) {
        delete newCart[itemId];
      } else {
        newCart[itemId] = {
          ...existing,
          quantity: existing.quantity - 1
        };
      }
      return newCart;
    });
  };

  // Math totals
  const subtotal = Object.values(cart).reduce(
    (sum, c) => sum + c.item.price * c.quantity,
    0
  );

  const getTipAmount = () => {
    if (tipType === 'none') return 0;
    if (tipType === 'custom') {
      const val = parseFloat(customTip);
      return isNaN(val) || val < 0 ? 0 : val;
    }
    const percent = parseInt(tipType, 10);
    return (subtotal * percent) / 100;
  };

  const tipAmount = getTipAmount();
  const totalAmount = subtotal + tipAmount;
  const totalItemsCount = Object.values(cart).reduce((sum, c) => sum + c.quantity, 0);

  // Filter items
  const filteredItems = activeCategory === 'All'
    ? MENU_ITEMS
    : MENU_ITEMS.filter(item => item.category === activeCategory);

  // Submit order to database
  const handlePlaceOrder = async (e) => {
    e.preventDefault();
    if (!tableNumber.trim()) {
      alert('Please enter a table number.');
      return;
    }
    if (!customerName.trim()) {
      alert('Please enter your name.');
      return;
    }
    if (totalItemsCount === 0) {
      alert('Your cart is empty.');
      return;
    }

    setOrderState('submitting');
    setErrorMessage('');

    try {
      const orderItems = Object.values(cart).map((c) => ({
        id: c.item.id,
        name: c.item.name,
        price: c.item.price,
        quantity: c.quantity
      }));

      // Append tip as a special item in the items list
      if (tipAmount > 0) {
        orderItems.push({
          id: 'tip',
          name: 'Tip (Gratuity)',
          price: parseFloat(tipAmount.toFixed(2)),
          quantity: 1
        });
      }

      // Generate order number
      const randomOrderSuffix = Math.floor(100 + Math.random() * 900);
      const generatedOrderNo = `N-${randomOrderSuffix}`;

      const { data, error } = await supabase
        .from('orders')
        .insert([
          {
            order_no: generatedOrderNo,
            table_number: tableNumber.trim(),
            guest_name: customerName.trim(),
            items: orderItems,
            total: parseFloat(totalAmount.toFixed(2)),
            status: 'new'
          }
        ])
        .select();

      if (error) {
        throw error;
      }

      setOrderState('success');
      setCart({});
    } catch (err) {
      console.error('Error inserting order:', err);
      setOrderState('error');
      setErrorMessage(err.message || 'Failed to place order.');
    }
  };

  const handleResetOrder = () => {
    setOrderState('idle');
    // KEEP customerName and tableNumber intact so they don't have to fill it in again!
    setTipType('none'); // Reset tip picker back to 'none' for the next order round
    setCustomTip('');
    setIsCartOpen(false);
  };

  const handleEnterLounge = (e) => {
    e.preventDefault();
    if (!tableNumber.trim()) {
      alert('Please enter your Table Number before entering.');
      return;
    }
    setIsWelcomeScreen(false);
  };

  // Render Welcome Page
  if (isWelcomeScreen) {
    return (
      <div className="welcome-container">
        {/* Dynamic theme switcher in welcome screen */}
        <div style={{ position: 'absolute', top: '16px', right: '16px' }}>
          <div className="theme-selector">
            <button
              className={`theme-btn ${theme === 'warm' ? 'active' : ''}`}
              onClick={() => setTheme('warm')}
            >
              🕯️ Fine-Dining
            </button>
            <button
              className={`theme-btn ${theme === 'teal' ? 'active' : ''}`}
              onClick={() => setTheme('teal')}
            >
              🍸 Lounge
            </button>
          </div>
        </div>

        <div className="welcome-card">
          <div className="welcome-brand">Noir</div>
          <p className="welcome-tagline">Exquisite Dining Speakeasy</p>
          <div className="welcome-decor"></div>
          
          <form onSubmit={handleEnterLounge}>
            <div className="welcome-input-group">
              <label htmlFor="welcome-table-input" className="welcome-label">
                Please Confirm Your Table Number
              </label>
              <input
                id="welcome-table-input"
                type="text"
                pattern="[0-9a-zA-Z]*"
                className="welcome-input"
                placeholder="Table Number (e.g. 5)"
                value={tableNumber}
                onChange={(e) => setTableNumber(e.target.value)}
                autoFocus
                required
              />
            </div>
            
            <button type="submit" className="welcome-btn">
              {theme === 'warm' ? '🕯️ Enter Lounge' : '🍸 Enter Speakeasy'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Render Menu Page
  return (
    <>
      {/* Header bar */}
      <header className="header">
        <div className="brand-wrapper">
          <span className="brand-title">Noir</span>
          <span className="table-badge">Table {tableNumber || '?'}</span>
        </div>

        <div className="theme-selector">
          <button
            className={`theme-btn ${theme === 'warm' ? 'active' : ''}`}
            onClick={() => setTheme('warm')}
          >
            🕯️ Fine-Dining
          </button>
          <button
            className={`theme-btn ${theme === 'teal' ? 'active' : ''}`}
            onClick={() => setTheme('teal')}
          >
            🍸 Lounge
          </button>
        </div>
      </header>

      {/* Main menu content */}
      <main className="container">
        <section className="hero">
          <h1>Welcome to Noir</h1>
          <p>
            An exquisite culinary escape. Select dishes from our curation below, customize your order ticket, and send it directly to our chefs.
          </p>
        </section>

        {/* Categories Tab Navigation */}
        <div className="categories-nav">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              className={`category-tab ${activeCategory === cat ? 'active' : ''}`}
              onClick={() => setActiveCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Menu Listings */}
        <div>
          <h2 className="menu-section-title">{activeCategory} Selection</h2>
          <div className="menu-grid">
            {filteredItems.map((item) => {
              const cartItem = cart[item.id];
              const qty = cartItem ? cartItem.quantity : 0;
              return (
                <div key={item.id} className="menu-card">
                  <div>
                    <div className="menu-card-header">
                      <span className="menu-item-name">{item.name}</span>
                      <span className="menu-item-price">${item.price.toFixed(2)}</span>
                    </div>
                    <p className="menu-item-desc">{item.desc}</p>
                  </div>

                  <div className="menu-item-meta">
                    <div className="dietary-tags">
                      {item.tags.map((tag) => (
                        <span
                          key={tag}
                          className={`tag ${
                            tag === 'Veg' ? 'veg' : tag === 'Gluten-Free' ? 'gluten-free' : 'non-veg'
                          }`}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>

                    {qty > 0 ? (
                      <div className="counter-control">
                        <button onClick={() => removeFromCart(item.id)}>−</button>
                        <span>{qty}</span>
                        <button onClick={() => addToCart(item)}>+</button>
                      </div>
                    ) : (
                      <button className="counter-btn" onClick={() => addToCart(item)}>
                        Add +
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </main>

      {/* Floating Cart Bar */}
      {totalItemsCount > 0 && !isCartOpen && (
        <div className="checkout-bar" onClick={() => setIsCartOpen(true)}>
          <div className="checkout-info">
            <div className="cart-icon-wrapper">
              <span>🧾</span>
              <span className="cart-count-badge">{totalItemsCount}</span>
            </div>
            <span className="checkout-text">View order ticket</span>
          </div>
          <span className="checkout-total">
            ${subtotal.toFixed(2)}
            <span>→</span>
          </span>
        </div>
      )}

      {/* Drawer Overlay */}
      <div className={`cart-overlay ${isCartOpen ? 'open' : ''}`}>
        <div className="cart-sheet">
          {/* Main physical ticket */}
          <div className="ticket">
            {orderState === 'submitting' ? (
              <div className="ticket-loading">
                <div className="spinner"></div>
                <h2>Sending Ticket...</h2>
                <p>Establishing secure connection and sending details to the kitchen.</p>
              </div>
            ) : orderState === 'success' ? (
              <div className="ticket-success">
                <div className="success-icon">✓</div>
                <h2>Order Sent!</h2>
                <p>Your order is live. The kitchen team has received your ticket and is preparing your meal.</p>
                <div className="ticket-meta" style={{ width: '100%', marginBottom: '16px' }}>
                  <span>TABLE: {tableNumber}</span>
                  <span>TIME: {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <button className="btn-submit-order" style={{ width: '100%' }} onClick={handleResetOrder}>
                  Order More
                </button>
              </div>
            ) : orderState === 'error' ? (
              <div className="ticket-success" style={{ minHeight: 'auto', padding: '20px 0' }}>
                <div className="success-icon" style={{ color: '#F44336' }}>✕</div>
                <h2>Submission Failed</h2>
                <p>{errorMessage}</p>
                <button className="btn-submit-order" style={{ width: '100%', backgroundColor: '#F44336' }} onClick={() => setOrderState('idle')}>
                  Retry
                </button>
              </div>
            ) : (
              <>
                <div className="ticket-header">
                  <div className="ticket-brand">Noir</div>
                  <div className="ticket-meta">
                    <span>TABLE: {tableNumber || '?'}</span>
                    <span>{new Date().toLocaleDateString()}</span>
                  </div>
                </div>

                {/* Items in ticket */}
                <div className="ticket-items">
                  {Object.values(cart).map(({ item, quantity }) => (
                    <div key={item.id} className="ticket-item-row">
                      <div className="ticket-item-name-qty">
                        <span className="ticket-item-name">{item.name}</span>
                        <span className="ticket-item-qty">
                          {quantity} x ${item.price.toFixed(2)}
                        </span>
                      </div>
                      <span className="ticket-item-price">
                        ${(item.price * quantity).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="ticket-separator"></div>

                {/* Tip Selector */}
                <div className="tip-section">
                  <span className="ticket-input-label">Select Gratuity</span>
                  <div className="tip-picker-grid">
                    <button
                      type="button"
                      className={`tip-chip ${tipType === '10' ? 'active' : ''}`}
                      onClick={() => setTipType('10')}
                    >
                      10%
                    </button>
                    <button
                      type="button"
                      className={`tip-chip ${tipType === '15' ? 'active' : ''}`}
                      onClick={() => setTipType('15')}
                    >
                      15%
                    </button>
                    <button
                      type="button"
                      className={`tip-chip ${tipType === '20' ? 'active' : ''}`}
                      onClick={() => setTipType('20')}
                    >
                      20%
                    </button>
                    <button
                      type="button"
                      className={`tip-chip ${tipType === 'custom' ? 'active' : ''}`}
                      onClick={() => setTipType('custom')}
                    >
                      Custom
                    </button>
                    <button
                      type="button"
                      className={`tip-chip ${tipType === 'none' ? 'active' : ''}`}
                      onClick={() => setTipType('none')}
                    >
                      None
                    </button>
                  </div>

                  {tipType === 'custom' && (
                    <div className="custom-tip-container">
                      <div className="custom-tip-input-wrapper">
                        <span className="custom-tip-symbol">$</span>
                        <input
                          type="number"
                          className="custom-tip-input"
                          placeholder="0.00"
                          min="0"
                          step="0.01"
                          value={customTip}
                          onChange={(e) => setCustomTip(e.target.value)}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Table Number & Name Inputs */}
                <div className="ticket-input-group" style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '10px' }}>
                  <div>
                    <label className="ticket-input-label" htmlFor="ticket-table-number">
                      Table
                    </label>
                    <input
                      id="ticket-table-number"
                      type="text"
                      className="ticket-input"
                      placeholder="e.g. 4"
                      value={tableNumber}
                      onChange={(e) => setTableNumber(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="ticket-input-label" htmlFor="customer-name">
                      Guest Name
                    </label>
                    <input
                      id="customer-name"
                      type="text"
                      className="ticket-input"
                      placeholder="Enter your name"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      required
                    />
                  </div>
                </div>

                {/* Calculation Breakdown */}
                <div className="ticket-calculations">
                  <div className="calc-row">
                    <span>Subtotal</span>
                    <span>${subtotal.toFixed(2)}</span>
                  </div>
                  <div className="calc-row">
                    <span>Gratuity</span>
                    <span>${tipAmount.toFixed(2)}</span>
                  </div>
                  <div className="calc-row total">
                    <span>Total</span>
                    <span>${totalAmount.toFixed(2)}</span>
                  </div>
                </div>

                {/* Submit / Close buttons */}
                <div className="ticket-actions">
                  <button
                    className="btn-submit-order"
                    onClick={handlePlaceOrder}
                    disabled={!customerName.trim() || !tableNumber.trim() || totalItemsCount === 0}
                  >
                    🔔 Submit to Kitchen
                  </button>
                  <button
                    className="btn-close-cart"
                    onClick={() => setIsCartOpen(false)}
                  >
                    Add More Items
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export default App;
