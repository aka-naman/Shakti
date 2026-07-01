import { useState, useEffect, useRef } from 'react';
import api from '../api/client';

export default function AutocompleteInput({ value, onChange, onSelect, placeholder }) {
    const [query, setQuery] = useState(value || '');
    const [prevValue, setPrevValue] = useState(value);
    const [suggestions, setSuggestions] = useState([]);
    const [showDropdown, setShowDropdown] = useState(false);
    const [loading, setLoading] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    const debounceRef = useRef(null);
    const wrapperRef = useRef(null);

    // Sync external value changes
    if (value !== prevValue) {
        setQuery(value || '');
        setPrevValue(value);
    }

    // Close dropdown on outside click
    useEffect(() => {
        function handleClick(e) {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
                setShowDropdown(false);
            }
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    const searchUniversities = (q) => {
        if (q.length < 2) {
            setSuggestions([]);
            setShowDropdown(false);
            return;
        }

        setLoading(true);
        api.get(`/autocomplete/university?q=${encodeURIComponent(q)}`)
            .then(res => {
                setSuggestions(res.data.results || []);
                setShowDropdown(true);
                setHighlightedIndex(-1);
            })
            .catch(() => setSuggestions([]))
            .finally(() => setLoading(false));
    };

    const handleInputChange = (e) => {
        const val = e.target.value;
        setQuery(val);
        onChange(val);

        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => searchUniversities(val), 300);
    };

    const handleSelect = (item) => {
        if (item === 'ADD_NEW') {
            setShowDropdown(false);
            if (onSelect) onSelect({ isNew: true, name: query });
            return;
        }
        setQuery(item.name);
        setSuggestions([]);
        setShowDropdown(false);
        onChange(item.name);
        if (onSelect) onSelect(item);
    };

    const handleKeyDown = (e) => {
        if (!showDropdown) return;

        // Total items = suggestions + 1 (for Add New)
        const totalItems = suggestions.length + 1;
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlightedIndex(prev => (prev + 1) % totalItems);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlightedIndex(prev => (prev <= 0 ? totalItems - 1 : prev - 1));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (highlightedIndex === suggestions.length) {
                handleSelect('ADD_NEW');
            } else if (highlightedIndex >= 0) {
                handleSelect(suggestions[highlightedIndex]);
            }
        } else if (e.key === 'Escape') {
            setShowDropdown(false);
        }
    };

    return (
        <div className="autocomplete-wrapper" ref={wrapperRef}>
            <div className="autocomplete-input-container">
                <input
                    type="text"
                    className="form-input"
                    value={query}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    onFocus={() => { if (query.length >= 2) setShowDropdown(true); }}
                    placeholder={placeholder || 'Start typing university name...'}
                    autoComplete="off"
                />
                {loading && <span className="autocomplete-spinner"></span>}
            </div>
            {showDropdown && (
                <ul className="autocomplete-dropdown">
                    {suggestions.map((item, idx) => (
                        <li
                            key={idx}
                            className={`autocomplete-item ${idx === highlightedIndex ? 'highlighted' : ''}`}
                            onMouseDown={(e) => { e.preventDefault(); handleSelect(item); }}
                            onMouseEnter={() => setHighlightedIndex(idx)}
                        >
                            <span className="autocomplete-name">
                                {item.name} {item.acronym ? `(${item.acronym})` : ''}
                            </span>
                            <span className="autocomplete-meta">{item.district}, {item.state}</span>
                        </li>
                    ))}
                    <li 
                        className={`autocomplete-item-new ${highlightedIndex === suggestions.length ? 'highlighted' : ''}`}
                        onMouseDown={(e) => { e.preventDefault(); handleSelect('ADD_NEW'); }}
                        onMouseEnter={() => setHighlightedIndex(suggestions.length)}
                    >
                        ✨ Not in list? Click to add "{query}"
                    </li>
                </ul>
            )}
        </div>
    );
}
