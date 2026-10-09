export const samples = {
  bash: '#!/bin/bash\necho "${HOME}"\nif true; then pwd; fi',
  css: '@media screen { .example { color: red; margin: 10px; } }',
  diff: '@@ -1 +1 @@\n-old\n+new',
  go: 'package main\nfunc main() { fmt.Println("hello") }',
  javascript: 'class Example { method(value) { return value + 1; } }\nconst result = new Example();',
  json: '{"message": "hello", "count": 1, "active": true, "empty": null}',
  python: '@decorator\nclass Example:\n    def method(self, x: int):\n        return f"value={x}"',
  rust: '#[derive(Debug)]\nstruct Example { count: u32 }\nfn main() { println!("hello"); }',
  typescript: 'interface Example { count: number }\nfunction read<T>(x: T): T { return x; }',
  xml: '<div class="example">hello</div><script>const x = 1;</script><style>p { color: red; }</style>',
};
