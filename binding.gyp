{
  "targets": [
    {
      "target_name": "clonefile",
      "sources": ["native/clonefile.cc"],
      "conditions": [
        ["OS=='mac'", { "defines": ["COW_DARWIN=1"] }],
        ["OS!='mac'", { "defines": ["COW_DARWIN=0"] }]
      ]
    }
  ]
}
