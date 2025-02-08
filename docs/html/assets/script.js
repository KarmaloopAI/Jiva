// Documentation Search Class
class DocumentationSearch {
    constructor() {
        this.searchIndex = null;
        this.searchInput = document.querySelector('.search-input');
        this.searchResults = document.querySelector('.search-results');
        this.currentResults = [];
        
        this.initializeSearch();
        this.setupKeyboardShortcuts();
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if (e.key === '/' && document.activeElement !== this.searchInput) {
                e.preventDefault();
                this.searchInput.focus();
            } else if (e.key === 'Escape') {
                this.clearResults();
                this.searchInput.blur();
            }
        });
    }

    async initializeSearch() {
        try {
            // Load the manifest from the html/assets directory
            const script = document.createElement('script');
            script.src = this._getManifestPath();
            
            // Create a promise that resolves when the manifest is loaded
            const manifestPromise = new Promise((resolve, reject) => {
                window.loadDocumentationManifest = (manifest) => {
                    resolve(manifest);
                };
                script.onerror = () => reject(new Error('Failed to load manifest'));
            });

            // Add script to document
            document.body.appendChild(script);

            // Wait for manifest to load
            const manifest = await manifestPromise;
            this.searchIndex = this.buildSearchIndex(manifest);
            this.setupEventListeners();
            
            // Clean up
            document.body.removeChild(script);
            delete window.loadDocumentationManifest;
        } catch (error) {
            console.error('Failed to load manifest:', error);
        }
    }


    _getManifestPath() {
        // Check if we're on a reference page or main index
        const isReference = window.location.pathname.includes('/reference/');
        // From reference pages: "../assets/manifest.jsonp"
        // From index page: "assets/manifest.jsonp"
        return (isReference ? '../assets/manifest.jsonp' : 'assets/manifest.jsonp');
    }
    buildSearchIndex(manifest) {
        const index = {};
        for (const [path, file] of Object.entries(manifest.files)) {
            index[path] = {
                purpose: file.purpose || '',
                elements: file.elements || [],
                language: file.language || 'Unknown',
                dependencies: file.dependencies || []
            };
        }
        return index;
    }

    setupEventListeners() {
        this.searchInput?.addEventListener('input', () => this.handleSearch());
        this.searchInput?.addEventListener('focus', () => {
            document.body.classList.add('search-active');
        });
        
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.search-container')) {
                this.clearResults();
            }
        });
    }

    handleSearch() {
        const query = this.searchInput.value.toLowerCase();
        if (!query) {
            this.clearResults();
            return;
        }

        const results = this.performSearch(query);
        this.displayResults(results);
    }

    performSearch(query) {
        if (!this.searchIndex) return [];

        const results = [];
        const seen = new Set();

        // Search through all files
        for (const [filepath, fileData] of Object.entries(this.searchIndex)) {
            // Search in file path and purpose
            if (filepath.toLowerCase().includes(query) || 
                fileData.purpose.toLowerCase().includes(query)) {
                results.push({
                    type: 'file',
                    name: filepath,
                    excerpt: fileData.purpose,
                    filepath: filepath,
                    language: fileData.language
                });
                seen.add(filepath);
            }

            // Search in elements
            fileData.elements?.forEach(element => {
                if (element.name.toLowerCase().includes(query) ||
                    element.purpose?.toLowerCase().includes(query) ||
                    element.documentation?.toLowerCase().includes(query)) {
                    results.push({
                        type: 'element',
                        name: element.name,
                        excerpt: element.purpose || element.documentation,
                        filepath: filepath,
                        elementType: element.type
                    });
                }
            });
        }

        return results.slice(0, 10); // Limit to 10 results
    }

    displayResults(results) {
        this.currentResults = results;
        
        const html = results.map((result, index) => `
            <div class="search-result-item" data-index="${index}">
                <div class="result-title">
                    <strong>${this._escapeHtml(result.name)}</strong>
                    <span class="result-type">${result.type === 'file' ? result.language : result.elementType}</span>
                </div>
                <div class="result-excerpt">${this._escapeHtml(result.excerpt)}</div>
                <div class="result-file">${this._escapeHtml(result.filepath)}</div>
            </div>
        `).join('');
        
        this.searchResults.innerHTML = html;
        
        // Add click handlers
        this.searchResults.querySelectorAll('.search-result-item').forEach(item => {
            item.addEventListener('click', () => this.handleResultClick(item));
        });
    }

    handleResultClick(item) {
        const result = this.currentResults[item.dataset.index];
        let url;
        
        if (result.type === 'file') {
            url = `reference/${result.filepath.replaceAll('/', '_')}.html`;
        } else {
            url = `reference/${result.filepath.replaceAll('/', '_')}.html#${result.name.toLowerCase()}`;
        }
        
        // Handle relative paths based on current location
        const isReference = window.location.pathname.includes('/reference/');
        if (isReference) {
            url = '../' + url;
        }
        
        window.location.href = url;
    }

    clearResults() {
        this.currentResults = [];
        this.searchResults.innerHTML = '';
        document.body.classList.remove('search-active');
    }

    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}

class DependencyGraph {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        if (!this.container) return;

        // Get current file path from URL
        const currentPath = this.getCurrentFilePath();
        if (!currentPath) return;

        // Build dependency data from manifest
        this.data = this.buildDataFromManifest(currentPath);
        if (!this.data) return;

        this.width = this.container.offsetWidth;
        this.height = 400;
        this.margin = { top: 40, right: 120, bottom: 40, left: 120 };
        
        this.initializeGraph();
    }

    basename(path) {
        return path.split('/').pop();  // Simply return the last part of the path
    }

    getCurrentFilePath() {
        // Get filename from URL and convert back to path
        const filename = window.location.pathname.split('/').pop().replace('.html', '');
        if (!filename) return null;
        return filename.replaceAll('_', '/');
    }

    buildDataFromManifest(currentPath) {
        const searchInstance = document.querySelector('.search-input')?.__search;
        if (!searchInstance || !searchInstance.searchIndex) return null;

        const nodes = [];
        const links = [];
        const currentFile = searchInstance.searchIndex[currentPath];
        
        if (!currentFile) return null;

        // Add current file node
        nodes.push({
            id: this.basename(currentPath),
            fullPath: currentPath,
            type: 'current',
            level: 1
        });

        // Add dependencies (left side)
        const dependencies = currentFile.dependencies
            ?.map(dep => ({
                id: this.basename(dep.name),
                fullPath: dep.name,
                type: 'dependency',
                level: 0
            })) || [];
        nodes.push(...dependencies);

        // Add links from dependencies
        dependencies.forEach(dep => {
            links.push({
                source: dep.id,
                target: this.basename(currentPath),
                type: 'dependency'
            });
        });

        // Add exposures (right side)
        const exposures = currentFile.elements
            ?.filter(elem => elem.type === 'function' || elem.type === 'class')
            ?.map(exp => ({
                id: exp.name,
                type: 'exposure',
                level: 2
            })) || [];
        nodes.push(...exposures);

        // Add links to exposures
        exposures.forEach(exp => {
            links.push({
                source: this.basename(currentPath),
                target: exp.id,
                type: 'exposure'
            });
        });

        // Look for usage in other files
        for (const [path, file] of Object.entries(searchInstance.searchIndex)) {
            if (path === currentPath) continue;

            // Check if any exposure is used in this file
            const usedExposures = exposures.filter(exp => 
                file.elements?.some(elem => 
                    (elem.type === 'dependency' || elem.type === 'import') &&
                    elem.name.endsWith(exp.id)
                )
            );

            usedExposures.forEach(exp => {
                nodes.push({
                    id: this.basename(path),
                    fullPath: path,
                    type: 'dependent',
                    level: 3
                });

                links.push({
                    source: exp.id,
                    target: this.basename(path),
                    type: 'usage'
                });
            });
        }

        // Remove duplicate nodes
        const uniqueNodes = Array.from(
            new Map(nodes.map(node => [node.id, node])).values()
        );

        return { nodes: uniqueNodes, links };
    }

    processData(data) {
        // Create levels: dependencies -> current file -> exposures
        const nodes = [];
        const links = [];
        const currentNode = {
            id: data.nodes.find(n => n.type === 'current').id,
            type: 'current',
            level: 1  // middle level
        };
        nodes.push(currentNode);

        // Process dependencies (left side)
        const dependencies = data.nodes
            .filter(n => n.type === 'dependency')
            .map(n => ({
                id: n.id,
                type: 'dependency',
                level: 0  // left level
            }));
        nodes.push(...dependencies);

        // Add links from dependencies to current
        dependencies.forEach(dep => {
            links.push({
                source: dep.id,
                target: currentNode.id,
                type: 'dependency'
            });
        });

        // Process exposures (right side)
        if (data.exposures) {
            data.exposures.forEach(exp => {
                nodes.push({
                    id: exp,
                    type: 'exposure',
                    level: 2  // right level
                });
                links.push({
                    source: currentNode.id,
                    target: exp,
                    type: 'exposure'
                });
            });
        }

        return { nodes, links };
    }

    initializeGraph() {
        this.container.innerHTML = '';
        
        const svg = d3.select(this.container)
            .append('svg')
            .attr('width', this.width)
            .attr('height', this.height)
            .append('g')
            .attr('transform', `translate(${this.margin.left},${this.margin.top})`);

        // Define arrow markers
        this.defineArrows(svg);

        // Calculate positions
        const graphWidth = this.width - this.margin.left - this.margin.right;
        const graphHeight = this.height - this.margin.top - this.margin.bottom;

        // Create level scales
        const levels = [0, 1, 2];  // left, middle, right
        const xScale = d3.scalePoint()
            .domain(levels)
            .range([0, graphWidth]);

        // Position nodes
        this.data.nodes.forEach(node => {
            node.x = xScale(node.level);
            node.y = graphHeight / 2 + (Math.random() - 0.5) * graphHeight * 0.5;
        });

        // Create links
        const link = svg.append('g')
            .selectAll('path')
            .data(this.data.links)
            .enter()
            .append('path')
            .attr('class', 'link')
            .attr('d', d => this.generateLinkPath(d))
            .attr('stroke', '#999')
            .attr('stroke-opacity', 0.6)
            .attr('stroke-width', d => d.type === 'dependency' ? 2 : 1)
            .attr('fill', 'none')
            .attr('marker-end', d => `url(#arrow-${d.type})`);

        // Create nodes
        const node = svg.append('g')
            .selectAll('.node')
            .data(this.data.nodes)
            .enter()
            .append('g')
            .attr('class', 'node')
            .attr('transform', d => `translate(${d.x},${d.y})`);

        // Add node circles
        node.append('circle')
            .attr('r', 6)
            .attr('fill', d => this.getNodeColor(d.type));

        // Add node labels
        node.append('text')
            .attr('x', d => d.level === 0 ? -12 : 12)
            .attr('y', 0)
            .attr('text-anchor', d => d.level === 0 ? 'end' : 'start')
            .attr('dy', '.35em')
            .text(d => d.id)
            .style('font-size', '12px');

        // Add hover effects
        node.on('mouseover', (event, d) => {
            this.highlightConnections(svg, d);
        }).on('mouseout', () => {
            this.resetHighlights(svg);
        });
    }

    defineArrows(svg) {
        const defs = svg.append('defs');

        // Dependency arrow
        defs.append('marker')
            .attr('id', 'arrow-dependency')
            .attr('viewBox', '0 -5 10 10')
            .attr('refX', 18)
            .attr('refY', 0)
            .attr('markerWidth', 6)
            .attr('markerHeight', 6)
            .attr('orient', 'auto')
            .append('path')
            .attr('d', 'M0,-5L10,0L0,5')
            .attr('fill', '#64748b');

        // Exposure arrow
        defs.append('marker')
            .attr('id', 'arrow-exposure')
            .attr('viewBox', '0 -5 10 10')
            .attr('refX', 18)
            .attr('refY', 0)
            .attr('markerWidth', 6)
            .attr('markerHeight', 6)
            .attr('orient', 'auto')
            .append('path')
            .attr('d', 'M0,-5L10,0L0,5')
            .attr('fill', '#059669');
    }

    generateLinkPath(d) {
        const sourceNode = this.data.nodes.find(n => n.id === d.source);
        const targetNode = this.data.nodes.find(n => n.id === d.target);
        
        const dx = targetNode.x - sourceNode.x;
        const dy = targetNode.y - sourceNode.y;
        const dr = Math.sqrt(dx * dx + dy * dy);
        
        return `M${sourceNode.x},${sourceNode.y}
                C${sourceNode.x + dr/3},${sourceNode.y}
                 ${targetNode.x - dr/3},${targetNode.y}
                 ${targetNode.x},${targetNode.y}`;
    }

    getNodeColor(type) {
        switch (type) {
            case 'current': return '#2563eb';
            case 'dependency': return '#64748b';
            case 'exposure': return '#059669';
            default: return '#94a3b8';
        }
    }

    highlightConnections(svg, node) {
        // Dim all elements
        svg.selectAll('.link').attr('stroke-opacity', 0.1);
        svg.selectAll('.node').attr('opacity', 0.1);

        // Highlight connected nodes and links
        const connectedLinks = this.data.links.filter(
            l => l.source === node.id || l.target === node.id
        );
        const connectedNodes = new Set(
            connectedLinks.flatMap(l => [l.source, l.target])
        );

        // Highlight relevant elements
        svg.selectAll('.link')
            .filter(l => connectedLinks.includes(l))
            .attr('stroke-opacity', 1);
        
        svg.selectAll('.node')
            .filter(n => connectedNodes.has(n.id) || n.id === node.id)
            .attr('opacity', 1);
    }

    resetHighlights(svg) {
        svg.selectAll('.link').attr('stroke-opacity', 0.6);
        svg.selectAll('.node').attr('opacity', 1);
    }
}

// Theme handling
class ThemeManager {
    constructor() {
        this.themeToggle = document.getElementById('themeToggle');
        this.sunIcon = document.querySelector('.sun-icon');
        this.moonIcon = document.querySelector('.moon-icon');
        
        // Initialize theme from localStorage or system preference
        this.initializeTheme();
        this.setupListeners();
    }

    initializeTheme() {
        // Check localStorage first
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme) {
            this.setTheme(savedTheme);
        } else {
            // Check system preference
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            this.setTheme(prefersDark ? 'dark' : 'light');
        }
    }

    setupListeners() {
        // Theme toggle button
        this.themeToggle?.addEventListener('click', () => {
            const newTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            this.setTheme(newTheme);
        });

        // Listen for system theme changes
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
            if (!localStorage.getItem('theme')) {
                this.setTheme(e.matches ? 'dark' : 'light');
            }
        });
    }

    setTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
        
        // Update toggle button icons
        if (this.sunIcon && this.moonIcon) {
            if (theme === 'dark') {
                this.sunIcon.style.display = 'none';
                this.moonIcon.style.display = 'block';
            } else {
                this.sunIcon.style.display = 'block';
                this.moonIcon.style.display = 'none';
            }
        }
    }
}

// Tab handling
class TabManager {
    constructor() {
        this.tabsContainer = document.querySelector('.tabs');
        this.tabPanes = document.querySelectorAll('.tab-pane');
        
        this.setupListeners();
        this.initFromHash();
    }

    setupListeners() {
        this.tabsContainer?.addEventListener('click', (e) => {
            const tabButton = e.target.closest('.tab');
            if (!tabButton) return;

            const tabId = tabButton.dataset.tab;
            this.activateTab(tabId);
            
            // Update URL hash without scrolling
            history.pushState(null, null, `#${tabId}`);
        });

        // Listen for hash changes
        window.addEventListener('hashchange', () => this.initFromHash());
    }

    initFromHash() {
        const hash = window.location.hash.slice(1);
        if (hash && document.querySelector(`[data-tab="${hash}"]`)) {
            this.activateTab(hash);
        } else {
            // Default to first tab
            const firstTab = document.querySelector('.tab');
            if (firstTab) {
                this.activateTab(firstTab.dataset.tab);
            }
        }
    }

    activateTab(tabId) {
        // Update tab buttons
        const tabs = this.tabsContainer?.querySelectorAll('.tab');
        tabs?.forEach(tab => {
            if (tab.dataset.tab === tabId) {
                tab.classList.add('active');
                tab.setAttribute('aria-selected', 'true');
            } else {
                tab.classList.remove('active');
                tab.setAttribute('aria-selected', 'false');
            }
        });

        // Update tab panes
        this.tabPanes?.forEach(pane => {
            if (pane.id === tabId) {
                pane.classList.add('active');
            } else {
                pane.classList.remove('active');
            }
        });
    }
}

// Initialize components
document.addEventListener('DOMContentLoaded', () => {
    // Initialize search first
    const searchInstance = new DocumentationSearch();

    // Initialize new components
    const themeManager = new ThemeManager();
    const tabManager = new TabManager();
    
    // Wait for manifest to be loaded before initializing graph
    const waitForManifest = setInterval(() => {
        if (searchInstance.searchIndex) {
            clearInterval(waitForManifest);
            
            // Initialize dependency graph if container exists
            const graphContainer = document.getElementById('dependencyGraph');
            if (graphContainer) {
                // Store search instance for access to manifest
                document.querySelector('.search-input').__search = searchInstance;
                new DependencyGraph('dependencyGraph');
            }
        }
    }, 100);

    // Add keyboard shortcut for search
    document.addEventListener('keydown', (e) => {
        if (e.key === '/' && document.activeElement !== searchInput) {
            e.preventDefault();
            searchInput?.focus();
        }
    });
});