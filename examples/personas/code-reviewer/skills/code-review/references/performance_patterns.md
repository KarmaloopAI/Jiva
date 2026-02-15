# Performance Optimization Patterns

## Common Performance Issues

### 1. Inefficient Algorithms

#### O(n²) vs O(n)
❌ **Bad:**
```javascript
// O(n²) - nested loops
for (let i = 0; i < items.length; i++) {
  for (let j = 0; j < otherItems.length; j++) {
    if (items[i].id === otherItems[j].id) {
      // match found
    }
  }
}
```

✅ **Good:**
```javascript
// O(n) - use a Map
const itemMap = new Map(otherItems.map(item => [item.id, item]));
for (const item of items) {
  if (itemMap.has(item.id)) {
    // match found
  }
}
```

### 2. Unnecessary Database Queries

#### N+1 Problem
❌ **Bad:**
```javascript
const users = await db.query('SELECT * FROM users');
for (const user of users) {
  // N additional queries!
  user.posts = await db.query('SELECT * FROM posts WHERE user_id = ?', [user.id]);
}
```

✅ **Good:**
```javascript
// Single query with JOIN
const usersWithPosts = await db.query(`
  SELECT u.*, p.* 
  FROM users u 
  LEFT JOIN posts p ON u.id = p.user_id
`);
// Group results
```

### 3. Missing Caching

❌ **Bad:**
```javascript
app.get('/api/config', async (req, res) => {
  // Reads file on every request
  const config = await fs.readFile('config.json', 'utf-8');
  res.json(JSON.parse(config));
});
```

✅ **Good:**
```javascript
let configCache = null;

app.get('/api/config', async (req, res) => {
  if (!configCache) {
    const data = await fs.readFile('config.json', 'utf-8');
    configCache = JSON.parse(data);
  }
  res.json(configCache);
});
```

### 4. Synchronous Blocking Operations

❌ **Bad:**
```javascript
// Blocks event loop
const result = fs.readFileSync('large-file.txt', 'utf-8');
processData(result);
```

✅ **Good:**
```javascript
// Non-blocking
const result = await fs.promises.readFile('large-file.txt', 'utf-8');
processData(result);
```

### 5. Memory Leaks

#### Event Listeners
❌ **Bad:**
```javascript
setInterval(() => {
  element.addEventListener('click', handler); // Leaks!
}, 1000);
```

✅ **Good:**
```javascript
element.addEventListener('click', handler);
// Clean up when done:
element.removeEventListener('click', handler);
```

#### Closures Holding References
❌ **Bad:**
```javascript
function processLargeData() {
  const largeArray = new Array(1000000).fill('data');
  
  return function() {
    // Closure keeps largeArray in memory!
    console.log('Processing...');
  };
}
```

✅ **Good:**
```javascript
function processLargeData() {
  const largeArray = new Array(1000000).fill('data');
  const result = doSomething(largeArray);
  
  // Don't capture largeArray in closure
  return function() {
    console.log('Result:', result);
  };
}
```

## Optimization Strategies

### Database

1. **Indexing**: Add indexes on frequently queried columns
2. **Query Optimization**: Use EXPLAIN to analyze queries
3. **Connection Pooling**: Reuse database connections
4. **Batch Operations**: Bulk inserts instead of individual
5. **Pagination**: Limit result sets with OFFSET/LIMIT

### Frontend

1. **Code Splitting**: Lazy load modules
2. **Image Optimization**: Compress images, use WebP
3. **Minification**: Minify JS/CSS
4. **CDN Usage**: Serve static assets from CDN
5. **Debouncing/Throttling**: Limit expensive operations

### Backend

1. **Caching Strategy**: Redis, memcached, in-memory
2. **Async Processing**: Queue heavy tasks
3. **Load Balancing**: Distribute traffic
4. **Compression**: gzip/brotli responses
5. **HTTP/2**: Enable HTTP/2 for multiplexing

## Benchmarking

Always measure before optimizing:

```javascript
console.time('operation');
// code to measure
console.timeEnd('operation');

// Or use performance.now()
const start = performance.now();
// code to measure
const duration = performance.now() - start;
console.log(`Took ${duration}ms`);
```

## Tools

- **Profiling**: Chrome DevTools, Node.js profiler
- **Load Testing**: Apache Bench, k6, Artillery
- **Monitoring**: New Relic, DataDog, Prometheus
- **Database**: pgAnalyze, MySQL slow query log

## References

- [Web Performance Best Practices](https://developer.mozilla.org/en-US/docs/Web/Performance)
- [Node.js Performance Best Practices](https://nodejs.org/en/docs/guides/simple-profiling/)
- [Database Performance Tuning](https://use-the-index-luke.com/)
