const [delay = '0', output = '', decision = ''] = process.argv.slice(2)
setTimeout(() => {
  if (decision) process.stdout.write(JSON.stringify({ decision, reason: 'denied by test hook' }))
  else process.stdout.write(output)
}, Number(delay))
