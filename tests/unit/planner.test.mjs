import assert from 'node:assert/strict'
import test from 'node:test'
import {randomUUID} from 'node:crypto'
import {validateLayout} from '../../server/planner.mjs'
test('manual layout input rejects fabricated IDs, invalid measurements, duplicates, dates and unbounded documents',()=>{
  const hole={id:randomUUID(),label:'1',par:3,distance_m:90,notes:''}
  const body={course_pin_id:randomUUID(),name:'Own observations',tee:'',basket:'',description:'',checked_on:null,holes:[hole]}
  assert.doesNotThrow(()=>validateLayout(body))
  for(const changed of [null,[],{...body,user_id:randomUUID()},{...body,name:' '},{...body,checked_on:'2026-02-31'},
    {...body,holes:Array(73).fill(hole)},{...body,holes:[hole,hole]},{...body,holes:[{...hole,par:1.5}]},
    {...body,holes:[{...hole,distance_m:0}]},{...body,holes:[{...hole,id:'1'}]}]){
    assert.throws(()=>validateLayout(changed),{status:400})
  }
})
